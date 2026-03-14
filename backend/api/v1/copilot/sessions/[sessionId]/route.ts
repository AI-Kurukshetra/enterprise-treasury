import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { ok } from '@/lib/http';
import { TreasuryCopilotService } from '@/services/copilot/copilot-service';

const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.string()
});

const ToolAuditSchema = z.object({
  tool: z.enum([
    'get_cash_position',
    'get_fx_rates',
    'list_pending_approvals',
    'get_risk_summary',
    'get_liquidity_forecast',
    'get_account_transactions',
    'get_investment_summary',
    'get_debt_summary'
  ]),
  input: z.record(z.string(), z.unknown()),
  executedAt: z.string(),
  source: z.string(),
  timestamp: z.string().nullable()
});

const CopilotMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string(),
  metadata: z
    .object({
      inReplyToId: z.string().optional(),
      toolCalls: z.array(ToolAuditSchema).optional(),
      usage: TokenUsageSchema.optional()
    })
    .optional()
});

const SessionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tokenUsage: TokenUsageSchema,
  messages: z.array(CopilotMessageSchema)
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  return executeRoute(request, { requiredPermission: 'copilot.access' }, async (_req, context) => {
    const { sessionId } = await params;
    const copilotService = new TreasuryCopilotService();
    const session = await copilotService.getSession(context.organizationId!, context.user!.id, sessionId);
    return ok(parseResponse(session, SessionSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
