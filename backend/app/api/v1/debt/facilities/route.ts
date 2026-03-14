import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { CreateDebtFacilityRequestSchema, ListDebtFacilitiesQuerySchema } from '@/schemas/debt/schema';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const DebtFacilitySchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  facility_name: z.string(),
  facility_type: z.enum(['revolver', 'term_loan', 'overdraft']),
  limit_amount: z.string(),
  utilized_amount: z.string(),
  currency_code: z.string().length(3),
  status: z.enum(['active', 'suspended', 'closed'])
});

const DebtFacilitiesListSchema = z.object({
  items: z.array(DebtFacilitySchema),
  nextCursor: z.string().nullable()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, ListDebtFacilitiesQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.debt.listFacilities({ status: query.status }, { cursor: query.cursor, limit: query.limit });
    return ok(parseResponse(result, DebtFacilitiesListSchema), context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'debt.create' }, async (_req, context) => {
    const body = await parseJsonBody(request, CreateDebtFacilityRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.debt.createFacility(body);
    return ok(parseResponse(result, DebtFacilitySchema), context.requestId, 201);
  });
}

export const OPTIONS = buildOptionsHandler();
