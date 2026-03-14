import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { ListInvestmentsQuerySchema, CreateInvestmentRequestSchema } from '@/schemas/investments/schema';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const InvestmentSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  instrument_name: z.string(),
  instrument_type: z.string(),
  principal_amount: z.string(),
  currency_code: z.string().length(3),
  maturity_date: z.string(),
  status: z.enum(['active', 'matured', 'redeemed'])
});

const ListInvestmentsResponseSchema = z.object({
  items: z.array(InvestmentSchema),
  nextCursor: z.string().nullable()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, ListInvestmentsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.investments.list(
      {
        status: query.status,
        maturityFrom: query.maturityFrom,
        maturityTo: query.maturityTo,
        instrumentType: query.instrumentType
      },
      { cursor: query.cursor, limit: query.limit }
    );

    return ok(parseResponse(result, ListInvestmentsResponseSchema), context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'investments.create' }, async (_req, context) => {
    const body = await parseJsonBody(request, CreateInvestmentRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.investments.create(body);
    return ok(parseResponse(result, InvestmentSchema), context.requestId, 201);
  });
}

export const OPTIONS = buildOptionsHandler();
