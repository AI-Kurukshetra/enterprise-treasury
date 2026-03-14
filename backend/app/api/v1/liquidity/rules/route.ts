import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { toServiceContext } from '@/api/serviceContext';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { ok } from '@/lib/http';
import { CreateSweepingRuleInputSchema } from '@/schemas/liquidity/schema';
import { buildServices } from '@/services/serviceFactory';

const ListRulesQuerySchema = z.object({
  poolId: z.string().uuid().optional()
});

const RuleSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  liquidity_pool_id: z.string().uuid(),
  rule_name: z.string(),
  source_account_id: z.string().uuid(),
  target_account_id: z.string().uuid(),
  min_balance: z.string(),
  target_balance: z.string(),
  max_transfer: z.string().nullable(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  last_executed_at: z.string().nullable().optional()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'liquidity.read' }, async (_req, context) => {
    const query = parseQuery(request, ListRulesQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.listSweepingRules(query.poolId);
    return ok(parseResponse(result, z.array(RuleSchema)), context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'liquidity.write' }, async (_req, context) => {
    const body = await parseJsonBody(request, CreateSweepingRuleInputSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.createRule(body);
    return ok(parseResponse(result, RuleSchema), context.requestId, 201);
  });
}

export const OPTIONS = buildOptionsHandler();
