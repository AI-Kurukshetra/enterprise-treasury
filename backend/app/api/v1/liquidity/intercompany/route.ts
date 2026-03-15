import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { toServiceContext } from '@/api/serviceContext';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { ok } from '@/lib/http';
import { CreateIntercompanyLoanInputSchema } from '@/schemas/liquidity/schema';
import { buildServices } from '@/services/serviceFactory';

const ListIntercompanyQuerySchema = z.object({
  status: z.enum(['proposed', 'active', 'settled', 'cancelled']).optional()
});

const IntercompanyLoanSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  lender_entity_id: z.string().uuid(),
  borrower_entity_id: z.string().uuid(),
  amount: z.union([z.string(), z.number()]).transform(String),
  currency_code: z.string().length(3),
  interest_rate: z.string().nullable(),
  status: z.enum(['proposed', 'active', 'settled', 'cancelled']),
  maturity_date: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  display_status: z.enum(['proposed', 'active', 'settled', 'cancelled', 'overdue']).optional(),
  approval_state: z.enum(['pending_bilateral_approval', 'approved']).optional()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'liquidity.read' }, async (_req, context) => {
    const query = parseQuery(request, ListIntercompanyQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.listLoans(query.status);
    return ok(parseResponse(result, z.array(IntercompanyLoanSchema)), context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'liquidity.write' }, async (_req, context) => {
    const body = await parseJsonBody(request, CreateIntercompanyLoanInputSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.createIntercompanyLoan(body);
    return ok(parseResponse(result, IntercompanyLoanSchema), context.requestId, 201);
  });
}

export const OPTIONS = buildOptionsHandler();
