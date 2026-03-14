import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { CashPositionHistoryQuerySchema } from '@/schemas/cash_positions/schema';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const CashTrendPointSchema = z.object({
  date: z.string(),
  label: z.string(),
  value: z.string(),
  projected: z.string(),
  buffer: z.string()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, CashPositionHistoryQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.cashPositions.getHistory({
      days: query.days ?? 30,
      granularity: query.granularity ?? 'daily'
    });
    return ok(parseResponse(result, z.array(CashTrendPointSchema)), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
