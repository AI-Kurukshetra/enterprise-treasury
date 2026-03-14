import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';
import { ListCounterpartiesQuerySchema } from '@/schemas/counterparties/schema';

const CounterpartySchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  type: z.enum(['customer', 'vendor', 'bank', 'affiliate', 'other']),
  country_code: z.string().nullable(),
  risk_rating: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const ListCounterpartiesResponseSchema = z.object({
  items: z.array(CounterpartySchema),
  nextCursor: z.string().nullable()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, ListCounterpartiesQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.counterparties.list(
      {
        type: query.type,
        search: query.search
      },
      {
        cursor: query.cursor,
        limit: query.limit
      }
    );

    return ok(parseResponse(result, ListCounterpartiesResponseSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
