import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { toServiceContext } from '@/api/serviceContext';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { ok } from '@/lib/http';
import { CreatePoolInputSchema, ListPoolsQuerySchema } from '@/schemas/liquidity/schema';
import { buildServices } from '@/services/serviceFactory';

const PoolSummarySchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  pool_type: z.enum(['physical', 'notional']),
  base_currency: z.string().length(3),
  created_at: z.string(),
  updated_at: z.string(),
  account_count: z.number().int().nonnegative(),
  active_rule_count: z.number().int().nonnegative(),
  total_balance: z.string(),
  available_balance: z.string(),
  trapped_cash: z.string(),
  last_sweep_at: z.string().nullable()
});

const PoolDetailSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  pool_type: z.enum(['physical', 'notional']),
  base_currency: z.string().length(3),
  created_at: z.string(),
  updated_at: z.string(),
  accounts: z.array(
    z.object({
      id: z.string().uuid(),
      organization_id: z.string().uuid(),
      liquidity_pool_id: z.string().uuid(),
      bank_account_id: z.string().uuid(),
      priority: z.number().int().positive(),
      created_at: z.string(),
      updated_at: z.string(),
      account_name: z.string().optional(),
      account_number_masked: z.string().optional(),
      currency_code: z.string().optional(),
      country_code: z.string().nullable().optional(),
      status: z.enum(['active', 'dormant', 'closed']).optional(),
      available_balance: z.string().optional(),
      current_balance: z.string().optional(),
      as_of_at: z.string().nullable().optional()
    })
  ),
  rules: z.array(
    z.object({
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
    })
  ),
  summary: PoolSummarySchema
});

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'liquidity.read' }, async (_req, context) => {
    const query = parseQuery(request, ListPoolsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.listPools(query);
    return ok(parseResponse(result, z.array(PoolSummarySchema)), context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'liquidity.write' }, async (_req, context) => {
    const body = await parseJsonBody(request, CreatePoolInputSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.createPool(body);
    return ok(parseResponse(result, PoolDetailSchema), context.requestId, 201);
  });
}

export const OPTIONS = buildOptionsHandler();
