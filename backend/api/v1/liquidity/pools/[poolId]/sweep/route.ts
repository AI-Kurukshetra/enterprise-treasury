import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { toServiceContext } from '@/api/serviceContext';
import { parseResponse } from '@/api/validation';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const SweepExecutionResultSchema = z.object({
  rule_id: z.string().uuid(),
  pool_id: z.string().uuid(),
  status: z.enum(['executed', 'skipped']),
  reason: z.string().optional(),
  transfer_amount: z.string().nullable(),
  source_account_id: z.string().uuid(),
  target_account_id: z.string().uuid(),
  executed_at: z.string()
});

interface RouteParams {
  params: Promise<{ poolId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, { requiredPermission: 'liquidity.write' }, async (_req, context) => {
    const { poolId } = await params;
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.executePoolSweep(poolId);
    return ok(parseResponse(result, z.array(SweepExecutionResultSchema)), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
