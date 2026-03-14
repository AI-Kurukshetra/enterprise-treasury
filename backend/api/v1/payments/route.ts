import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { PAYMENT_STATUSES } from '@/constants/financial';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';
import { CreatePaymentRequestSchema, ListPaymentsQuerySchema } from '@/schemas/payments/schema';

const PolicyWarningSchema = z.object({
  policyId: z.string().uuid(),
  policyName: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  action: z.enum(['warn', 'require_approval', 'auto_approve']),
  message: z.string()
});

const PaymentSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  payment_reference: z.string(),
  source_account_id: z.string().uuid(),
  beneficiary_counterparty_id: z.string().uuid(),
  amount: z.string(),
  currency_code: z.string().length(3),
  value_date: z.string(),
  purpose: z.string().nullable(),
  notes: z.string().nullable().optional(),
  status: z.enum(PAYMENT_STATUSES),
  idempotency_key: z.string(),
  request_id: z.string().nullable(),
  created_by: z.string().uuid(),
  approval_workflow_id: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  executed_at: z.string().nullable(),
  failure_reason: z.string().nullable(),
  policy_warnings: z.array(PolicyWarningSchema).optional(),
  version: z.number().int().positive(),
  updated_at: z.string(),
  created_at: z.string()
});

const ListPaymentsResponseSchema = z.object({
  items: z.array(PaymentSchema),
  nextCursor: z.string().nullable()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, ListPaymentsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.payments.list(
      {
        status: query.status,
        fromDate: query.fromDate,
        toDate: query.toDate,
        accountId: query.accountId,
        minAmount: query.minAmount,
        maxAmount: query.maxAmount,
        beneficiaryId: query.beneficiaryId
      },
      {
        cursor: query.cursor,
        limit: query.limit
      }
    );

    return ok(parseResponse(result, ListPaymentsResponseSchema), context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(
    request,
    {
      requiredPermission: 'payments.create',
      useIdempotency: true,
      rateLimit: 'api.sensitive'
    },
    async (_req, context) => {
      const body = await parseJsonBody(request, CreatePaymentRequestSchema);
      const services = buildServices(toServiceContext(context));
      const result = await services.payments.create(body, context.user!.id, context.idempotencyKey!);
      return ok(parseResponse(result, PaymentSchema), context.requestId, 201);
    }
  );
}

export const OPTIONS = buildOptionsHandler();
