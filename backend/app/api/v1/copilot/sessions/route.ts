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

const SessionSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessagePreview: z.string().nullable(),
  tokenUsage: TokenUsageSchema
});

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'copilot.access' }, async (_req, context) => {
    const copilotService = new TreasuryCopilotService();
    const sessions = await copilotService.listSessions(context.organizationId!, context.user!.id);
    return ok(parseResponse(sessions, z.array(SessionSummarySchema)), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
