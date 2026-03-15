import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const InvestmentSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  instrument_name: z.string(),
  instrument_type: z.string(),
  principal_amount: z.union([z.string(), z.number()]).transform(String),
  currency_code: z.string().length(3),
  maturity_date: z.string(),
  status: z.enum(['active', 'matured', 'redeemed'])
});

interface RouteParams {
  params: Promise<{ investmentId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, {}, async (_req, context) => {
    const { investmentId } = await params;
    const services = buildServices(toServiceContext(context));
    const result = await services.investments.getById(investmentId);
    return ok(parseResponse(result, InvestmentSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
