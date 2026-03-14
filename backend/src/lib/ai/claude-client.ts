import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '@/errors/AppError';
import { getEnv } from '@/config/env';
import { logger } from '@/lib/logger';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { assertNoQueryError } from '@/repositories/base/execute';

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const CLAUDE_TIMEOUT_MS = 30_000;
const CLAUDE_OVERLOAD_RETRIES = 2;

export interface ClaudeUsageContext {
  organizationId: string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ClaudeJsonInvocation {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  usageContext: ClaudeUsageContext;
}

export interface ClaudeJsonResult {
  model: string;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

let cachedClient: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (cachedClient) {
    return cachedClient;
  }

  const env = getEnv();
  cachedClient = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: CLAUDE_TIMEOUT_MS,
    maxRetries: 0
  });

  return cachedClient;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function extractTextContent(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function isOverloadError(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status?: number }).status : undefined;
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? String((error as { message?: string }).message ?? '') : '';

  return status === 529 || message.toLowerCase().includes('overload');
}

function estimateUsageCostUsd(inputTokens: number, outputTokens: number): number {
  const env = getEnv();
  const inputCost = (inputTokens / 1_000_000) * env.ANTHROPIC_INPUT_COST_PER_MILLION_TOKENS;
  const outputCost = (outputTokens / 1_000_000) * env.ANTHROPIC_OUTPUT_COST_PER_MILLION_TOKENS;
  return Number((inputCost + outputCost).toFixed(6));
}

async function recordUsageMetric(
  usageContext: ClaudeUsageContext,
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
): Promise<void> {
  try {
    const db = createServiceSupabaseClient();
    const { error } = await db.from('usage_metrics').insert({
      organization_id: usageContext.organizationId,
      actor_id: usageContext.actorId ?? null,
      provider: 'anthropic',
      model: CLAUDE_MODEL,
      metric_type: 'llm_tokens',
      entity_type: usageContext.entityType ?? null,
      entity_id: usageContext.entityId ?? null,
      request_id: usageContext.requestId ?? null,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      estimated_cost_usd: estimateUsageCostUsd(usage.inputTokens, usage.outputTokens),
      metadata: usageContext.metadata ?? {},
      created_by: usageContext.actorId ?? null,
      updated_by: usageContext.actorId ?? null
    });

    assertNoQueryError(error);
  } catch (error) {
    logger.warn('Failed to persist Claude usage metric', {
      organizationId: usageContext.organizationId,
      entityType: usageContext.entityType,
      entityId: usageContext.entityId,
      error: error instanceof Error ? error.message : 'Unknown usage metric error'
    });
  }
}

export async function invokeClaudeJson(input: ClaudeJsonInvocation): Promise<ClaudeJsonResult> {
  const env = getEnv();
  let lastError: unknown;

  for (let attempt = 0; attempt <= CLAUDE_OVERLOAD_RETRIES; attempt += 1) {
    try {
      const response = await getClaudeClient().messages.create({
        model: CLAUDE_MODEL,
        max_tokens: input.maxTokens ?? env.ANTHROPIC_MAX_TOKENS,
        temperature: input.temperature ?? 0,
        system: input.system,
        messages: [
          {
            role: 'user',
            content: input.prompt
          }
        ]
      });

      const usage = {
        inputTokens: response.usage.input_tokens ?? 0,
        outputTokens: response.usage.output_tokens ?? 0,
        totalTokens: (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0)
      };

      await recordUsageMetric(input.usageContext, usage);

      return {
        model: CLAUDE_MODEL,
        text: extractTextContent(response),
        usage
      };
    } catch (error) {
      lastError = error;

      if (!isOverloadError(error) || attempt >= CLAUDE_OVERLOAD_RETRIES) {
        break;
      }

      await sleep((attempt + 1) * 750);
    }
  }

  throw new AppError('Claude API request failed', {
    statusCode: 502,
    code: 'AI_PROVIDER_ERROR',
    details: {
      provider: 'anthropic',
      model: CLAUDE_MODEL,
      reason: lastError instanceof Error ? lastError.message : 'Unknown Claude API error'
    }
  });
}
