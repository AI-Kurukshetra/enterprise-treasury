import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { toServiceContext } from '@/api/serviceContext';
import { parseQuery, parseResponse } from '@/api/validation';
import { ok } from '@/lib/http';
import { LiquidityPositionQuerySchema } from '@/schemas/liquidity/schema';
import { buildServices } from '@/services/serviceFactory';

const ConcentrationBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  total_balance: z.string(),
  available_balance: z.string().optional(),
  trapped_cash: z.string().optional(),
  operating_cash: z.string().optional(),
  reserve_cash: z.string().optional(),
  concentration_pct: z.string().optional(),
  limit_pct: z.string().optional(),
  breached: z.boolean().optional()
});

const LiquidityPositionSchema = z.object({
  pool_id: z.string().uuid(),
  pool_name: z.string(),
  pool_type: z.enum(['physical', 'notional']),
  base_currency: z.string().length(3),
  total_balance: z.string(),
  available_balance: z.string(),
  trapped_cash: z.string(),
  operating_cash: z.string(),
  reserve_cash: z.string(),
  account_count: z.number().int().nonnegative(),
  active_rule_count: z.number().int().nonnegative(),
  last_sweep_at: z.string().nullable(),
  regions: z.array(z.string())
});

const PositionResponseSchema = z.object({
  generated_at: z.string(),
  total_balance: z.string(),
  available_balance: z.string(),
  trapped_cash: z.string(),
  runway_days: z.number().int().nullable(),
  pools: z.array(LiquidityPositionSchema),
  concentration_analysis: z.object({
    by_region: z.array(ConcentrationBucketSchema),
    by_currency: z.array(ConcentrationBucketSchema),
    by_entity_type: z.array(ConcentrationBucketSchema)
  })
});

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'liquidity.read' }, async (_req, context) => {
    const query = parseQuery(request, LiquidityPositionQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.getLiquidityPosition(query);
    return ok(parseResponse(result, PositionResponseSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
