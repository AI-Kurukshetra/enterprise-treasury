import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';
import { CreateAccountRequestSchema, ListAccountsQuerySchema } from '@/schemas/accounts/schema';

const AccountSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  bank_connection_id: z.string().uuid().nullable(),
  account_name: z.string(),
  account_number_masked: z.string(),
  currency_code: z.string().length(3),
  region: z.string().nullable(),
  liquidity_type: z.enum(['operating', 'reserve']),
  withdrawal_restricted: z.boolean(),
  current_balance: z.string().optional(),
  available_balance: z.string().optional(),
  restricted_balance: z.string().optional(),
  reconciliation_status: z.enum(['reconciled', 'attention', 'no_activity']).optional(),
  status: z.enum(['active', 'dormant', 'closed']),
  created_at: z.string(),
  updated_at: z.string()
});

const ListAccountsResponseSchema = z.object({
  items: z.array(AccountSchema),
  nextCursor: z.string().nullable()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, ListAccountsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.accounts.list(
      {
        status: query.status,
        currencyCode: query.currencyCode,
        bankConnectionId: query.bankConnectionId
      },
      { cursor: query.cursor, limit: query.limit }
    );

    const response = parseResponse(result, ListAccountsResponseSchema);
    return ok(response, context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'accounts.create' }, async (_req, context) => {
    const body = await parseJsonBody(request, CreateAccountRequestSchema);
    const services = buildServices(toServiceContext(context));
    const created = await services.accounts.create(body);
    const response = parseResponse(created, AccountSchema);
    return ok(response, context.requestId, 201);
  });
}

export const OPTIONS = buildOptionsHandler();
