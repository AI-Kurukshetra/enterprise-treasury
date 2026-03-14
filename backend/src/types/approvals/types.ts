import type { UUID } from '@/types/common';

export interface ApprovalDecisionInput {
  paymentId: UUID;
  rowVersionToken: string;
  comment?: string;
}

export interface PendingApprovalItem {
  paymentId: UUID;
  paymentReference: string;
  amount: string;
  currencyCode: string;
  valueDate: string;
  createdAt: string;
  rowVersionToken: string;
}
