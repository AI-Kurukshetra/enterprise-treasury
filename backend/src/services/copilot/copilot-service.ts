import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { buildServices, type ServiceFactory } from '@/services/serviceFactory';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { treasuryTools, treasuryToolStatusLabels, type TreasuryToolDefinition } from '@/lib/ai/treasury-tools';
import { getEnv } from '@/config/env';
import { NotFoundError } from '@/errors/NotFoundError';
import { ValidationError } from '@/errors/ValidationError';
import { CashPositionAggregationService } from '@/services/cash-positions/aggregation-service';
import { logger } from '@/lib/logger';
import {
  addAmounts,
  compareDecimalStrings,
  divideDecimalStrings,
  formatDecimalString,
  sumDecimalStrings
} from '@/utils/money';

type CopilotRole = 'user' | 'assistant';
type AnthropicMessage = {
  role: CopilotRole;
  content: string | Array<Record<string, unknown>>;
};

export interface CopilotTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  estimatedCostUsd: string;
}

export interface CopilotToolAudit {
  tool: TreasuryToolDefinition['name'];
  input: Record<string, unknown>;
  executedAt: string;
  source: string;
  timestamp: string | null;
}

export interface CopilotMessage {
  id: string;
  role: CopilotRole;
  content: string;
  createdAt: string;
  metadata?: {
    inReplyToId?: string;
    toolCalls?: CopilotToolAudit[];
    usage?: CopilotTokenUsage;
  };
}

interface StoredCopilotMessage {
  id: string;
  role: CopilotRole;
  content: string;
  createdAt: string;
  metadata?: CopilotMessage['metadata'];
}

interface CopilotSessionRow {
  id: string;
  organization_id: string;
  user_id: string;
  title: string | null;
  messages: unknown;
  token_usage: unknown;
  created_at: string;
  updated_at: string;
}

export interface CopilotSession {
  id: string;
  organizationId: string;
  userId: string;
  title: string | null;
  messages: CopilotMessage[];
  tokenUsage: CopilotTokenUsage;
  createdAt: string;
  updatedAt: string;
}

export interface CopilotSessionSummary {
  id: string;
  title: string | null;
  updatedAt: string;
  createdAt: string;
  lastMessagePreview: string | null;
  tokenUsage: CopilotTokenUsage;
}

export type CopilotChunk =
  | {
      type: 'text';
      content: string;
    }
  | {
      type: 'tool_call';
      tool: TreasuryToolDefinition['name'];
      content: string;
    };

interface PreparedSession {
  session: CopilotSession;
  replayMessage: CopilotMessage | null;
}

const MAX_TOOL_ITERATIONS = 6;
const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_TOOL_LIMIT = 10;
const CURRENCY_SCALE = 6;
const SSE_REPLAY_CHUNK_SIZE = 48;

const emptyTokenUsage = (): CopilotTokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  estimatedCostUsd: '0.000000'
});

const CopilotUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheCreationInputTokens: z.number().int().nonnegative().default(0),
  cacheReadInputTokens: z.number().int().nonnegative().default(0),
  estimatedCostUsd: z.string().default('0.000000')
});

const OrganizationPositionToolSchema = z.object({
  type: z.enum(['organization', 'account']),
  accountId: z.string().uuid().optional(),
  currencyCode: z.string().trim().length(3).optional(),
  asOf: z.string().optional()
});

const FxRatesToolSchema = z.object({
  baseCurrency: z.string().trim().length(3),
  quoteCurrencies: z.array(z.string().trim().length(3)).min(1)
});

const PendingApprovalsToolSchema = z.object({
  limit: z.number().int().positive().max(50).optional()
});

const RiskSummaryToolSchema = z.object({
  riskType: z.enum(['fx', 'interest_rate', 'credit', 'liquidity']).optional()
});

const LiquidityForecastToolSchema = z.object({
  days: z.number().int().positive().max(365),
  currencyCode: z.string().trim().length(3).optional()
});

const AccountTransactionsToolSchema = z.object({
  accountId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  direction: z.enum(['inflow', 'outflow']).optional(),
  limit: z.number().int().positive().max(100).optional()
});

const InvestmentSummaryToolSchema = z.object({
  currencyCode: z.string().trim().length(3).optional()
});

const DebtSummaryToolSchema = z.object({});

export class TreasuryCopilotService {
  private readonly db: SupabaseClient;
  private readonly anthropic: Anthropic | null;

  constructor(
    private readonly deps: {
      db?: SupabaseClient;
      anthropic?: Anthropic;
      serviceFactory?: (context: { organizationId: string; userId: string; requestId: string }) => ServiceFactory;
    } = {}
  ) {
    this.db = deps.db ?? createServiceSupabaseClient();
    const env = getEnv();
    this.anthropic =
      deps.anthropic ??
      (env.ANTHROPIC_API_KEY
        ? new Anthropic({
            apiKey: env.ANTHROPIC_API_KEY
          })
        : null);
  }

  async prepareSession(input: {
    organizationId: string;
    userId: string;
    sessionId?: string;
    message: string;
    messageId?: string;
  }): Promise<PreparedSession> {
    const trimmedMessage = input.message.trim();
    if (!trimmedMessage) {
      throw new ValidationError('Copilot message cannot be empty');
    }

    const messageId = input.messageId ?? randomUUID();
    const existing = input.sessionId ? await this.getSessionInternal(input.organizationId, input.userId, input.sessionId) : null;

    if (existing) {
      const replayMessage =
        existing.messages.find(
          (message) => message.role === 'assistant' && message.metadata?.inReplyToId === messageId
        ) ?? null;
      if (replayMessage) {
        return {
          session: existing,
          replayMessage
        };
      }

      const alreadyAppended = existing.messages.some((message) => message.role === 'user' && message.id === messageId);
      const nextMessages: CopilotMessage[] = alreadyAppended
        ? existing.messages
        : [
            ...existing.messages,
            {
              id: messageId,
              role: 'user',
              content: trimmedMessage,
              createdAt: new Date().toISOString()
            }
          ];

      const updated = await this.persistSession(existing.id, existing.organizationId, existing.userId, {
        title: existing.title ?? generateSessionTitle(trimmedMessage),
        messages: nextMessages,
        tokenUsage: existing.tokenUsage
      });

      return {
        session: updated,
        replayMessage: null
      };
    }

    const createdAt = new Date().toISOString();
    const messages: CopilotMessage[] = [
      {
        id: messageId,
        role: 'user',
        content: trimmedMessage,
        createdAt
      }
    ];

    const { data, error } = await this.db
      .from('copilot_sessions')
      .insert({
        organization_id: input.organizationId,
        user_id: input.userId,
        title: generateSessionTitle(trimmedMessage),
        messages: encodeMessages(messages),
        token_usage: emptyTokenUsage()
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return {
      session: this.mapSessionRow(data as CopilotSessionRow),
      replayMessage: null
    };
  }

  async listSessions(organizationId: string, userId: string, limit = DEFAULT_LIST_LIMIT): Promise<CopilotSessionSummary[]> {
    const { data, error } = await this.db
      .from('copilot_sessions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return ((data ?? []) as CopilotSessionRow[]).map((row) => {
      const session = this.mapSessionRow(row);
      const lastMessage = session.messages.at(-1) ?? null;
      return {
        id: session.id,
        title: session.title,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
        lastMessagePreview: lastMessage ? truncateForPreview(lastMessage.content, 88) : null,
        tokenUsage: session.tokenUsage
      };
    });
  }

  async getSession(organizationId: string, userId: string, sessionId: string): Promise<CopilotSession> {
    return this.getSessionInternal(organizationId, userId, sessionId);
  }

  async chat(
    organizationId: string,
    userId: string,
    messages: CopilotMessage[],
    sessionId: string
  ): Promise<AsyncIterable<CopilotChunk>> {
    if (!this.anthropic) {
      throw new ValidationError('Anthropic API key is not configured');
    }

    const env = getEnv();
    const organizationName = await this.getOrganizationName(organizationId);
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    const requestId = randomUUID();
    const services = (this.deps.serviceFactory ?? buildServices)({
      organizationId,
      userId,
      requestId
    });
    const aggregationService = new CashPositionAggregationService(organizationId);
    const systemPrompt =
      `You are Atlas, an expert treasury analyst for ${organizationName}. ` +
      'You have real-time access to their cash positions, payments, FX rates, risk exposures, and forecasts. ' +
      'Answer questions precisely using the tools available. Always cite the data source and timestamp. ' +
      "For sensitive actions like approving payments, explain what would happen but don't execute without explicit confirmation. " +
      'Keep responses concise and use tables/bullets.';

    const anthropicMessages: AnthropicMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content
    }));

    const streamConversation = async function* (
      service: TreasuryCopilotService
    ): AsyncGenerator<CopilotChunk, void, undefined> {
      let accumulatedText = '';
      let accumulatedUsage = emptyTokenUsage();
      const toolAudits: CopilotToolAudit[] = [];

      for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
        const anthropicClient = service.anthropic as any;
        const response = (await anthropicClient.messages.create({
          model: env.ANTHROPIC_MODEL,
          max_tokens: env.ANTHROPIC_MAX_TOKENS,
          system: systemPrompt,
          messages: anthropicMessages,
          tools: treasuryTools,
          stream: true,
          temperature: 0
        })) as AsyncIterable<Record<string, unknown>>;

        const blockMap = new Map<
          number,
          | {
              type: 'text';
              text: string;
            }
          | {
              type: 'tool_use';
              id: string;
              name: TreasuryToolDefinition['name'];
              input: Record<string, unknown> | null;
              partialJson: string;
            }
        >();

        let streamedUsage = emptyTokenUsage();

        for await (const event of response) {
          const eventType = String(event.type ?? '');

          if (eventType === 'message_start') {
            streamedUsage = addUsage(streamedUsage, usageFromEvent((event as { message?: { usage?: unknown } }).message?.usage));
            continue;
          }

          if (eventType === 'content_block_start') {
            const index = Number((event as { index?: number }).index ?? 0);
            const contentBlock = (event as { content_block?: Record<string, unknown> }).content_block ?? {};

            if (contentBlock.type === 'text') {
              const text = asString(contentBlock.text) ?? '';
              blockMap.set(index, { type: 'text', text });
              if (text) {
                accumulatedText += text;
                yield {
                  type: 'text',
                  content: text
                };
              }
              continue;
            }

            if (contentBlock.type === 'tool_use') {
              blockMap.set(index, {
                type: 'tool_use',
                id: asString(contentBlock.id) ?? randomUUID(),
                name: (asString(contentBlock.name) ?? 'get_cash_position') as TreasuryToolDefinition['name'],
                input: asRecord(contentBlock.input),
                partialJson: ''
              });
            }
            continue;
          }

          if (eventType === 'content_block_delta') {
            const index = Number((event as { index?: number }).index ?? 0);
            const delta = (event as { delta?: Record<string, unknown> }).delta ?? {};
            const block = blockMap.get(index);

            if (!block) {
              continue;
            }

            if (block.type === 'text' && delta.type === 'text_delta') {
              const text = asString(delta.text) ?? '';
              block.text += text;
              if (text) {
                accumulatedText += text;
                yield {
                  type: 'text',
                  content: text
                };
              }
              continue;
            }

            if (block.type === 'tool_use' && delta.type === 'input_json_delta') {
              block.partialJson += asString(delta.partial_json) ?? '';
            }
            continue;
          }

          if (eventType === 'message_delta') {
            streamedUsage = addUsage(
              streamedUsage,
              usageFromEvent((event as { usage?: unknown }).usage)
            );
          }
        }

        accumulatedUsage = addUsage(accumulatedUsage, streamedUsage);

        const orderedBlocks = Array.from(blockMap.entries())
          .sort(([left], [right]) => left - right)
          .map(([, block]) => finalizeResponseBlock(block));

        const assistantContent = orderedBlocks.map((block) =>
          block.type === 'text'
            ? {
                type: 'text',
                text: block.text
              }
            : {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input
              }
        );

        const toolBlocks = orderedBlocks.filter((block) => block.type === 'tool_use');
        if (toolBlocks.length === 0) {
          const assistantMessage: CopilotMessage = {
            id: randomUUID(),
            role: 'assistant',
            content: accumulatedText.trim() || 'No assistant response was returned.',
            createdAt: new Date().toISOString(),
            metadata: {
              inReplyToId: latestUserMessage?.id,
              toolCalls: toolAudits,
              usage: accumulatedUsage
            }
          };

          await service.appendAssistantMessage(sessionId, organizationId, userId, messages, assistantMessage);
          return;
        }

        anthropicMessages.push({
          role: 'assistant',
          content: assistantContent
        });

        const toolResults: Array<Record<string, unknown>> = [];

        for (const toolBlock of toolBlocks) {
          yield {
            type: 'tool_call',
            tool: toolBlock.name,
            content: treasuryToolStatusLabels[toolBlock.name]
          };

          try {
            const result = await service.executeTool(toolBlock.name, toolBlock.input, {
              organizationId,
              userId,
              services,
              aggregationService
            });

            toolAudits.push({
              tool: toolBlock.name,
              input: toolBlock.input,
              executedAt: new Date().toISOString(),
              source: asString((result as { source?: unknown }).source) ?? toolBlock.name,
              timestamp: asNullableString((result as { timestamp?: unknown }).timestamp)
            });

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: JSON.stringify(result, null, 2)
            });
          } catch (error) {
            logger.warn('copilot_tool_execution_failed', {
              tool: toolBlock.name,
              organizationId,
              userId,
              error: error instanceof Error ? error.message : 'Unknown tool error'
            });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolBlock.id,
              content: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : 'Unknown tool error'
                },
                null,
                2
              ),
              is_error: true
            });
          }
        }

        anthropicMessages.push({
          role: 'user',
          content: toolResults
        });
      }

      throw new ValidationError('Copilot exceeded the maximum tool iterations');
    };

    return streamConversation(this);
  }

  replayAssistantMessage(message: CopilotMessage): CopilotChunk[] {
    if (!message.content) {
      return [];
    }

    const chunks: CopilotChunk[] = [];
    for (let index = 0; index < message.content.length; index += SSE_REPLAY_CHUNK_SIZE) {
      chunks.push({
        type: 'text',
        content: message.content.slice(index, index + SSE_REPLAY_CHUNK_SIZE)
      });
    }
    return chunks;
  }

  private async appendAssistantMessage(
    sessionId: string,
    organizationId: string,
    userId: string,
    currentMessages: CopilotMessage[],
    assistantMessage: CopilotMessage
  ) {
    const session = await this.getSessionInternal(organizationId, userId, sessionId);
    const hasExistingReply = session.messages.some((message) => message.id === assistantMessage.id);
    if (hasExistingReply) {
      return session;
    }

    const nextMessages = [...currentMessages, assistantMessage];
    return this.persistSession(sessionId, organizationId, userId, {
      title: session.title,
      messages: nextMessages,
      tokenUsage: addUsage(session.tokenUsage, assistantMessage.metadata?.usage ?? emptyTokenUsage())
    });
  }

  private async persistSession(
    sessionId: string,
    organizationId: string,
    userId: string,
    payload: {
      title: string | null;
      messages: CopilotMessage[];
      tokenUsage: CopilotTokenUsage;
    }
  ): Promise<CopilotSession> {
    const { data, error } = await this.db
      .from('copilot_sessions')
      .update({
        title: payload.title,
        messages: encodeMessages(payload.messages),
        token_usage: payload.tokenUsage
      })
      .eq('id', sessionId)
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return this.mapSessionRow(data as CopilotSessionRow);
  }

  private async getSessionInternal(
    organizationId: string,
    userId: string,
    sessionId: string
  ): Promise<CopilotSession> {
    const { data, error } = await this.db
      .from('copilot_sessions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new NotFoundError('Copilot session not found');
    }

    return this.mapSessionRow(data as CopilotSessionRow);
  }

  private mapSessionRow(row: CopilotSessionRow): CopilotSession {
    return {
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      title: row.title,
      messages: decodeMessages(asArray(row.messages)),
      tokenUsage: parseTokenUsage(row.token_usage),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private async getOrganizationName(organizationId: string): Promise<string> {
    const { data, error } = await this.db
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .single();

    if (error) {
      throw error;
    }

    return asString((data as { name?: unknown }).name) ?? 'the organization';
  }

  private async executeTool(
    toolName: TreasuryToolDefinition['name'],
    rawInput: Record<string, unknown>,
    context: {
      organizationId: string;
      userId: string;
      services: ServiceFactory;
      aggregationService: CashPositionAggregationService;
    }
  ) {
    switch (toolName) {
      case 'get_cash_position':
        return this.getCashPositionTool(context, OrganizationPositionToolSchema.parse(rawInput));
      case 'get_fx_rates':
        return this.getFxRatesTool(context, FxRatesToolSchema.parse(rawInput));
      case 'list_pending_approvals':
        return this.listPendingApprovalsTool(context, PendingApprovalsToolSchema.parse(rawInput));
      case 'get_risk_summary':
        return this.getRiskSummaryTool(context, RiskSummaryToolSchema.parse(rawInput));
      case 'get_liquidity_forecast':
        return this.getLiquidityForecastTool(context, LiquidityForecastToolSchema.parse(rawInput));
      case 'get_account_transactions':
        return this.getAccountTransactionsTool(context, AccountTransactionsToolSchema.parse(rawInput));
      case 'get_investment_summary':
        return this.getInvestmentSummaryTool(context, InvestmentSummaryToolSchema.parse(rawInput));
      case 'get_debt_summary':
        return this.getDebtSummaryTool(context, DebtSummaryToolSchema.parse(rawInput));
    }
  }

  private async getCashPositionTool(
    context: {
      organizationId: string;
      services: ServiceFactory;
      aggregationService: CashPositionAggregationService;
    },
    input: z.infer<typeof OrganizationPositionToolSchema>
  ) {
    const currencyCode = input.currencyCode?.toUpperCase();

    if (input.type === 'organization') {
      const summary = await context.services.cashPositions.getLatest();
      return {
        source: 'cash_positions_latest',
        timestamp: input.asOf ?? summary.asOf,
        scope: 'organization',
        baseCurrency: summary.baseCurrency,
        totalCash: summary.totalCash,
        availableLiquidity: summary.availableLiquidity,
        pendingPayments: summary.pendingPayments,
        byCurrency:
          currencyCode != null
            ? summary.byCurrency.filter((item) => item.currencyCode === currencyCode)
            : summary.byCurrency
      };
    }

    if (!input.accountId) {
      throw new ValidationError('accountId is required when requesting account cash position');
    }

    const [account, positions] = await Promise.all([
      context.services.accounts.getById(input.accountId),
      context.aggregationService.getLatestAccountPositions(context.organizationId, [input.accountId])
    ]);
    const position = positions[0];
    if (!position) {
      throw new NotFoundError('Cash position snapshot not found for account');
    }

    if (currencyCode && currencyCode !== position.currency_code) {
      throw new ValidationError('Requested currency does not match account currency', {
        requestedCurrency: currencyCode,
        accountCurrency: position.currency_code
      });
    }

    return {
      source: 'cash_positions_latest',
      timestamp: input.asOf ?? position.as_of_at,
      scope: 'account',
      account: {
        id: account.id,
        name: account.account_name,
        accountNumberMasked: account.account_number_masked,
        currencyCode: account.currency_code,
        region: account.region
      },
      balances: {
        current: position.current_balance,
        available: position.available_balance,
        restricted: position.restricted_balance
      }
    };
  }

  private async getFxRatesTool(
    context: {
      services: ServiceFactory;
    },
    input: z.infer<typeof FxRatesToolSchema>
  ) {
    const baseCurrency = input.baseCurrency.toUpperCase();
    const quoteCurrencies = Array.from(new Set(input.quoteCurrencies.map((currency) => currency.toUpperCase())));
    const rates = await Promise.all(
      quoteCurrencies.map(async (quoteCurrency) => {
        const rate = await context.services.fx.getRate({
          base: baseCurrency,
          quote: quoteCurrency
        });
        return {
          baseCurrency,
          quoteCurrency,
          rate: rate.rate.toFixed(8),
          timestamp: rate.timestamp,
          source: rate.source
        };
      })
    );

    return {
      source: 'currency_rates',
      timestamp: rates[0]?.timestamp ?? new Date().toISOString(),
      baseCurrency,
      rates
    };
  }

  private async listPendingApprovalsTool(
    context: {
      userId: string;
      services: ServiceFactory;
    },
    input: z.infer<typeof PendingApprovalsToolSchema>
  ) {
    const pending = await context.services.approvals.listPending(context.userId);
    const limited = pending.slice(0, input.limit ?? DEFAULT_TOOL_LIMIT);
    const enriched = await Promise.all(
      limited.map(async (item) => {
        const detail = await context.services.payments.getDetail(item.paymentId, context.userId);
        return {
          paymentId: item.paymentId,
          paymentReference: item.paymentReference,
          amount: item.amount,
          currencyCode: item.currencyCode,
          valueDate: item.valueDate,
          createdAt: item.createdAt,
          beneficiary: detail.beneficiary?.name ?? 'Unknown beneficiary',
          rowVersionToken: item.rowVersionToken
        };
      })
    );

    return {
      source: 'payments',
      timestamp: enriched[0]?.createdAt ?? new Date().toISOString(),
      count: enriched.length,
      approvals: enriched
    };
  }

  private async getRiskSummaryTool(
    context: {
      services: ServiceFactory;
    },
    input: z.infer<typeof RiskSummaryToolSchema>
  ) {
    const snapshot = await context.services.risk.listExposures(
      input.riskType
        ? {
            riskType: input.riskType
          }
        : {}
    );

    return {
      source: 'risk_exposures',
      timestamp: snapshot.lastCalculatedAt ?? snapshot.valuationDate,
      riskType: input.riskType ?? 'all',
      summary: snapshot.summary,
      fx: input.riskType && input.riskType !== 'fx' ? [] : snapshot.fx,
      interestRate: input.riskType && input.riskType !== 'interest_rate' ? null : snapshot.interestRate,
      credit: input.riskType && input.riskType !== 'credit' ? [] : snapshot.concentration,
      liquidity: input.riskType && input.riskType !== 'liquidity' ? null : snapshot.liquidity
    };
  }

  private async getLiquidityForecastTool(
    context: {
      organizationId: string;
    },
    input: z.infer<typeof LiquidityForecastToolSchema>
  ) {
    const today = new Date().toISOString().slice(0, 10);
    const endDate = addUtcDays(new Date(`${today}T00:00:00.000Z`), input.days - 1).toISOString().slice(0, 10);
    const forecast = await this.findBestForecast(context.organizationId, input.currencyCode?.toUpperCase());

    if (!forecast) {
      return {
        source: 'cash_flow_forecasts',
        timestamp: null,
        horizonDays: input.days,
        forecast: null,
        lines: []
      };
    }

    const { data, error } = await this.db
      .from('cash_flow_forecast_lines')
      .select('forecast_date,projected_inflow,projected_outflow,projected_net,scenario,created_at,updated_at')
      .eq('organization_id', context.organizationId)
      .eq('forecast_id', forecast.id)
      .gte('forecast_date', today)
      .lte('forecast_date', endDate)
      .order('forecast_date', { ascending: true });

    if (error) {
      throw error;
    }

    const lines = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      forecastDate: asString(row.forecast_date) ?? today,
      projectedInflow: asString(row.projected_inflow) ?? '0.000000',
      projectedOutflow: asString(row.projected_outflow) ?? '0.000000',
      projectedNet: asString(row.projected_net) ?? '0.000000',
      scenario: asString(row.scenario) ?? 'base'
    }));

    return {
      source: 'cash_flow_forecasts',
      timestamp: asString(forecast.updated_at) ?? asString(forecast.created_at) ?? null,
      horizonDays: input.days,
      forecast: {
        id: asString(forecast.id),
        name: asString(forecast.name),
        currencyCode: asString(forecast.currency_code),
        status: asString(forecast.status),
        startDate: asString(forecast.start_date),
        endDate: asString(forecast.end_date)
      },
      totals: {
        projectedInflow: sumDecimalStrings(lines.map((line) => line.projectedInflow)),
        projectedOutflow: sumDecimalStrings(lines.map((line) => line.projectedOutflow)),
        projectedNet: sumDecimalStrings(lines.map((line) => line.projectedNet)),
        minimumProjectedNet: lines.reduce(
          (lowest, line) => (compareDecimalStrings(line.projectedNet, lowest) < 0 ? line.projectedNet : lowest),
          lines[0]?.projectedNet ?? '0.000000'
        )
      },
      lines
    };
  }

  private async getAccountTransactionsTool(
    context: {
      services: ServiceFactory;
    },
    input: z.infer<typeof AccountTransactionsToolSchema>
  ) {
    const result = await context.services.transactions.list(
      {
        accountId: input.accountId,
        direction: input.direction,
        fromDate: input.fromDate,
        toDate: input.toDate
      },
      {
        limit: input.limit ?? DEFAULT_TOOL_LIMIT
      }
    );

    return {
      source: 'transactions',
      timestamp: result.items[0]?.created_at ?? new Date().toISOString(),
      count: result.items.length,
      transactions: result.items.map((item) => ({
        id: item.id,
        bankAccountId: item.bank_account_id,
        bookingDate: item.booking_date,
        valueDate: item.value_date,
        amount: item.amount,
        currencyCode: item.currency_code,
        direction: item.direction,
        description: item.description,
        reconciliationStatus: item.reconciliation_status
      }))
    };
  }

  private async getInvestmentSummaryTool(
    context: {
      organizationId: string;
    },
    input: z.infer<typeof InvestmentSummaryToolSchema>
  ) {
    let query = this.db
      .from('investments')
      .select('id,instrument_name,instrument_type,principal_amount,currency_code,maturity_date,status,created_at,updated_at')
      .eq('organization_id', context.organizationId)
      .eq('status', 'active')
      .order('maturity_date', { ascending: true });

    if (input.currencyCode) {
      query = query.eq('currency_code', input.currencyCode.toUpperCase());
    }

    const { data, error } = await query.limit(250);
    if (error) {
      throw error;
    }

    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: asString(row.id) ?? randomUUID(),
      instrumentName: asString(row.instrument_name) ?? 'Unknown',
      instrumentType: asString(row.instrument_type) ?? 'other',
      principalAmount: asString(row.principal_amount) ?? '0.000000',
      currencyCode: asString(row.currency_code) ?? 'USD',
      maturityDate: asString(row.maturity_date) ?? new Date().toISOString().slice(0, 10),
      updatedAt: asString(row.updated_at) ?? asString(row.created_at) ?? new Date().toISOString()
    }));

    const totalsByCurrency = new Map<string, string>();
    for (const row of rows) {
      totalsByCurrency.set(row.currencyCode, addAmounts(totalsByCurrency.get(row.currencyCode) ?? '0.000000', row.principalAmount));
    }

    return {
      source: 'investments',
      timestamp: rows[0]?.updatedAt ?? new Date().toISOString(),
      count: rows.length,
      totalsByCurrency: Array.from(totalsByCurrency.entries()).map(([currencyCode, principalAmount]) => ({
        currencyCode,
        principalAmount
      })),
      holdings: rows.slice(0, 20)
    };
  }

  private async getDebtSummaryTool(
    context: {
      services: ServiceFactory;
    },
    _input: z.infer<typeof DebtSummaryToolSchema>
  ) {
    const facilities = await context.services.debt.listFacilities(
      {
        status: 'active'
      },
      {
        limit: 100
      }
    );

    const schedules = await Promise.all(
      facilities.items.slice(0, 20).map(async (facility) => ({
        facilityId: facility.id,
        lines: await context.services.debt.getSchedule(facility.id)
      }))
    );

    const totalsByCurrency = new Map<string, { limitAmount: string; utilizedAmount: string }>();
    for (const facility of facilities.items) {
      const current = totalsByCurrency.get(facility.currency_code) ?? {
        limitAmount: '0.000000',
        utilizedAmount: '0.000000'
      };
      current.limitAmount = addAmounts(current.limitAmount, facility.limit_amount);
      current.utilizedAmount = addAmounts(current.utilizedAmount, facility.utilized_amount);
      totalsByCurrency.set(facility.currency_code, current);
    }

    return {
      source: 'debt_facilities',
      timestamp: new Date().toISOString(),
      count: facilities.items.length,
      totalsByCurrency: Array.from(totalsByCurrency.entries()).map(([currencyCode, totals]) => ({
        currencyCode,
        limitAmount: totals.limitAmount,
        utilizedAmount: totals.utilizedAmount,
        utilizationRatio:
          compareDecimalStrings(totals.limitAmount, '0.000000') === 0
            ? '0.000000'
            : divideDecimalStrings(totals.utilizedAmount, totals.limitAmount, CURRENCY_SCALE)
      })),
      facilities: facilities.items.map((facility) => ({
        id: facility.id,
        facilityName: facility.facility_name,
        facilityType: facility.facility_type,
        currencyCode: facility.currency_code,
        limitAmount: facility.limit_amount,
        utilizedAmount: facility.utilized_amount,
        utilizationRatio:
          compareDecimalStrings(facility.limit_amount, '0.000000') === 0
            ? '0.000000'
            : divideDecimalStrings(facility.utilized_amount, facility.limit_amount, CURRENCY_SCALE)
      })),
      nextObligations: schedules
        .flatMap(({ facilityId, lines }) =>
          lines
            .filter((line) => line.status !== 'paid')
            .slice(0, 3)
            .map((line) => ({
              facilityId,
              dueDate: line.due_date,
              principalDue: line.principal_due,
              interestDue: line.interest_due,
              totalDue: addAmounts(line.principal_due, line.interest_due),
              status: line.status
            }))
        )
        .sort((left, right) => left.dueDate.localeCompare(right.dueDate))
        .slice(0, 10)
    };
  }

  private async findBestForecast(organizationId: string, currencyCode?: string) {
    let publishedQuery = this.db
      .from('cash_flow_forecasts')
      .select('id,name,currency_code,status,start_date,end_date,created_at,updated_at')
      .eq('organization_id', organizationId)
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (currencyCode) {
      publishedQuery = publishedQuery.eq('currency_code', currencyCode);
    }

    const { data: published, error: publishedError } = await publishedQuery;
    if (publishedError) {
      throw publishedError;
    }

    if (published && published.length > 0) {
      return published[0] as Record<string, unknown>;
    }

    let fallbackQuery = this.db
      .from('cash_flow_forecasts')
      .select('id,name,currency_code,status,start_date,end_date,created_at,updated_at')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (currencyCode) {
      fallbackQuery = fallbackQuery.eq('currency_code', currencyCode);
    }

    const { data: fallback, error: fallbackError } = await fallbackQuery;
    if (fallbackError) {
      throw fallbackError;
    }

    return fallback?.[0] as Record<string, unknown> | undefined;
  }
}

function finalizeResponseBlock(
  block:
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'tool_use';
        id: string;
        name: TreasuryToolDefinition['name'];
        input: Record<string, unknown> | null;
        partialJson: string;
      }
) {
  if (block.type === 'text') {
    return block;
  }

  if (block.partialJson) {
    return {
      type: 'tool_use' as const,
      id: block.id,
      name: block.name,
      input: JSON.parse(block.partialJson) as Record<string, unknown>
    };
  }

  return {
    type: 'tool_use' as const,
    id: block.id,
    name: block.name,
    input: block.input ?? {}
  };
}

function truncateForPreview(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function generateSessionTitle(message: string) {
  return truncateForPreview(message, 50);
}

function encodeMessages(messages: CopilotMessage[]): StoredCopilotMessage[] {
  return messages.map((message) => ({
    ...message,
    content: encryptContent(message.content)
  }));
}

function decodeMessages(messages: unknown[]): CopilotMessage[] {
  return messages.map((message) => {
    const record = asRecord(message);
    return {
      id: asString(record.id) ?? randomUUID(),
      role: (asString(record.role) ?? 'user') as CopilotRole,
      content: decryptContent(asString(record.content) ?? ''),
      createdAt: asString(record.createdAt) ?? new Date().toISOString(),
      metadata: asRecord(record.metadata) as CopilotMessage['metadata']
    };
  });
}

function encryptContent(plainText: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${encrypted.toString('base64url')}:${tag.toString('base64url')}`;
}

function decryptContent(payload: string): string {
  if (!payload.startsWith('enc:v1:')) {
    return payload;
  }

  const [, , ivPart, encryptedPart, tagPart] = payload.split(':');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivPart ?? '', 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagPart ?? '', 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart ?? '', 'base64url')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

let cachedEncryptionKey: Buffer | null = null;

function getEncryptionKey() {
  if (cachedEncryptionKey) {
    return cachedEncryptionKey;
  }

  const env = getEnv();
  const material = env.COPILOT_ENCRYPTION_KEY ?? `${env.SUPABASE_SERVICE_ROLE_KEY}:copilot`;
  cachedEncryptionKey = createHash('sha256').update(material).digest();
  return cachedEncryptionKey;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseTokenUsage(value: unknown): CopilotTokenUsage {
  return CopilotUsageSchema.parse(value ?? {});
}

function usageFromEvent(value: unknown): CopilotTokenUsage {
  const record = asRecord(value);
  const env = getEnv();
  const usage = {
    inputTokens: toInt(record.input_tokens),
    outputTokens: toInt(record.output_tokens),
    cacheCreationInputTokens: toInt(record.cache_creation_input_tokens),
    cacheReadInputTokens: toInt(record.cache_read_input_tokens)
  };
  const billableInputTokens = usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
  const estimatedCostUsd =
    ((billableInputTokens * env.ANTHROPIC_INPUT_COST_PER_MILLION_TOKENS) +
      (usage.outputTokens * env.ANTHROPIC_OUTPUT_COST_PER_MILLION_TOKENS)) /
    1_000_000;

  return {
    ...usage,
    estimatedCostUsd: formatDecimalString(estimatedCostUsd.toFixed(CURRENCY_SCALE))
  };
}

function addUsage(left: CopilotTokenUsage, right: CopilotTokenUsage): CopilotTokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheCreationInputTokens: left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    cacheReadInputTokens: left.cacheReadInputTokens + right.cacheReadInputTokens,
    estimatedCostUsd: addAmounts(left.estimatedCostUsd, right.estimatedCostUsd)
  };
}

function toInt(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
