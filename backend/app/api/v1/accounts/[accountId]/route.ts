import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';
import { UpdateAccountRequestSchema } from '@/schemas/accounts/schema';

const AccountSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  bank_connection_id: z.string().uuid(),
  account_name: z.string(),
  account_number_masked: z.string(),
  currency_code: z.string().length(3),
  status: z.enum(['active', 'dormant', 'closed']),
  created_at: z.string(),
  updated_at: z.string()
});

interface AccountRouteParams {
  params: Promise<{ accountId: string }>;
}

export async function GET(request: NextRequest, { params }: AccountRouteParams) {
  return executeRoute(request, {}, async (_req, context) => {
    const { accountId } = await params;
    const services = buildServices(toServiceContext(context));
    const account = await services.accounts.getById(accountId);
    return ok(parseResponse(account, AccountSchema), context.requestId);
  });
}

export async function PATCH(request: NextRequest, { params }: AccountRouteParams) {
  return executeRoute(request, { requiredPermission: 'accounts.update' }, async (_req, context) => {
    const { accountId } = await params;
    const body = await parseJsonBody(request, UpdateAccountRequestSchema);
    const services = buildServices(toServiceContext(context));
    const account = await services.accounts.update(accountId, body);
    return ok(parseResponse(account, AccountSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
