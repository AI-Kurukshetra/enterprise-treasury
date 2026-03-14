import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { ReconcileTransactionRequestSchema } from '@/schemas/transactions/schema';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

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

interface RouteParams {
  params: Promise<{ transactionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, { requiredPermission: 'transactions.reconcile' }, async (_req, context) => {
    await parseJsonBody(request, ReconcileTransactionRequestSchema);
    const { transactionId } = await params;
    const services = buildServices(toServiceContext(context));
    const transaction = await services.transactions.reconcile(transactionId);
    return ok(parseResponse(transaction, TransactionSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
