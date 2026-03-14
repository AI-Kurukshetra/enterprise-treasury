import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';
import { ListTransactionsQuerySchema } from '@/schemas/transactions/schema';

const TransactionSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  bank_account_id: z.string().uuid(),
  booking_date: z.string(),
  value_date: z.string().nullable(),
  amount: z.string(),
  currency_code: z.string().length(3),
  direction: z.enum(['inflow', 'outflow']),
  description: z.string().nullable(),
  reconciliation_status: z.enum(['unreconciled', 'partially_reconciled', 'reconciled', 'exception']),
  dedupe_hash: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});

const ListTransactionResponseSchema = z.object({
  items: z.array(TransactionSchema),
  nextCursor: z.string().nullable()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, ListTransactionsQuerySchema);
    const services = buildServices(toServiceContext(context));

    const result = await services.transactions.list(
      {
        accountId: query.accountId,
        direction: query.direction,
        reconciliationStatus: query.reconciliationStatus,
        fromDate: query.fromDate,
        toDate: query.toDate,
        minAmount: query.minAmount,
        maxAmount: query.maxAmount
      },
      {
        cursor: query.cursor,
        limit: query.limit
      }
    );

    return ok(parseResponse(result, ListTransactionResponseSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
