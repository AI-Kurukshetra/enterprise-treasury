import type { UUID } from '@/types/common';
import { PAYMENT_STATUSES } from '@/constants/financial';
import type { PolicyWarning } from '@/lib/policy-engine/policy-types';

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface Payment {
  id: UUID;
  organization_id: UUID;
  payment_reference: string;
  source_account_id: UUID;
  beneficiary_counterparty_id: UUID;
  amount: string;
  currency_code: string;
  value_date: string;
  purpose: string | null;
  notes?: string | null;
  status: PaymentStatus;
  idempotency_key: string;
  request_id: string | null;
  created_by: UUID;
  approval_workflow_id: UUID | null;
  approved_at: string | null;
  executed_at: string | null;
  failure_reason: string | null;
  policy_warnings?: PolicyWarning[];
  version: number;
  updated_at: string;
  created_at: string;
}

export interface CreatePaymentInput {
  paymentReference: string;
  sourceAccountId: UUID;
  beneficiaryCounterpartyId: UUID;
  amount: string;
  currencyCode: string;
  valueDate: string;
  purpose?: string;
}

export interface PaymentFilters {
  status?: PaymentStatus;
  fromDate?: string;
  toDate?: string;
  accountId?: UUID;
  minAmount?: string;
  maxAmount?: string;
  beneficiaryId?: UUID;
}

export interface PaymentParticipantSummary {
  id: UUID;
  displayName: string | null;
  email?: string | null;
}

export interface PaymentCounterpartySummary {
  id: UUID;
  name: string;
  type: 'customer' | 'vendor' | 'bank' | 'affiliate' | 'other';
  countryCode: string | null;
  riskRating: string | null;
}

export interface PaymentApprovalDecisionDetail {
  approvalStepId: UUID;
  approverUserId: UUID;
  decision: 'approved' | 'rejected';
  comment: string | null;
  decidedAt: string;
  approver: PaymentParticipantSummary | null;
}

export interface PaymentApprovalStepDetail {
  id: UUID;
  roleId: UUID;
  roleName: string;
  stepOrder: number;
  minApprovals: number;
  approvalsReceived: number;
  status: 'completed' | 'current' | 'pending' | 'rejected';
  decisions: PaymentApprovalDecisionDetail[];
}

export interface PaymentApprovalChainDetail {
  workflowId: UUID | null;
  currentStepId: UUID | null;
  alreadyApprovedByCurrentUser: boolean;
  steps: PaymentApprovalStepDetail[];
}

export interface PaymentDetail extends Payment {
  beneficiary: PaymentCounterpartySummary | null;
  submitter: PaymentParticipantSummary | null;
  approval_chain: PaymentApprovalChainDetail;
}
