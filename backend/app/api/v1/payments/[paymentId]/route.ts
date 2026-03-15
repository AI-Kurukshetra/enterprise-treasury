import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { PAYMENT_STATUSES } from '@/constants/financial';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const PaymentApprovalDecisionSchema = z.object({
  approvalStepId: z.string().uuid(),
  approverUserId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().nullable(),
  decidedAt: z.string(),
  approver: z
    .object({
      id: z.string().uuid(),
      displayName: z.string().nullable(),
      email: z.string().email().nullable().optional()
    })
    .nullable()
});

const PaymentApprovalStepSchema = z.object({
  id: z.string().uuid(),
  roleId: z.string().uuid(),
  roleName: z.string(),
  stepOrder: z.number().int().positive(),
  minApprovals: z.number().int().positive(),
  approvalsReceived: z.number().int().nonnegative(),
  status: z.enum(['completed', 'current', 'pending', 'rejected']),
  decisions: z.array(PaymentApprovalDecisionSchema)
});

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
  amount: z.union([z.string(), z.number()]).transform(String),
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
  created_at: z.string(),
  beneficiary: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      type: z.enum(['customer', 'vendor', 'bank', 'affiliate', 'other']),
      countryCode: z.string().nullable(),
      riskRating: z.string().nullable()
    })
    .nullable(),
  submitter: z
    .object({
      id: z.string().uuid(),
      displayName: z.string().nullable(),
      email: z.string().email().nullable().optional()
    })
    .nullable(),
  approval_chain: z.object({
    workflowId: z.string().uuid().nullable(),
    currentStepId: z.string().uuid().nullable(),
    alreadyApprovedByCurrentUser: z.boolean(),
    steps: z.array(PaymentApprovalStepSchema)
  })
});

interface RouteParams {
  params: Promise<{ paymentId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, {}, async (_req, context) => {
    const { paymentId } = await params;
    const services = buildServices(toServiceContext(context));
    const payment = await services.payments.getDetail(paymentId, context.user!.id);
    return ok(parseResponse(payment, PaymentSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
