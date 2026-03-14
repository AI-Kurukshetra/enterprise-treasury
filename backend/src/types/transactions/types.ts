import type { UUID } from '@/types/common';

export interface Transaction {
  id: UUID;
  organization_id: UUID;
  bank_account_id: UUID;
  booking_date: string;
  value_date: string | null;
  amount: string;
  currency_code: string;
  direction: 'inflow' | 'outflow';
  description: string | null;
  reconciliation_status: 'unreconciled' | 'partially_reconciled' | 'reconciled' | 'exception';
  dedupe_hash: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTransactionInput {
  bankAccountId: UUID;
  bookingDate: string;
  valueDate?: string;
  amount: string;
  currencyCode: string;
  direction: 'inflow' | 'outflow';
  description?: string;
  dedupeHash: string;
}

export interface TransactionFilters {
  accountId?: UUID;
  direction?: 'inflow' | 'outflow';
  reconciliationStatus?: 'unreconciled' | 'partially_reconciled' | 'reconciled' | 'exception';
  fromDate?: string;
  toDate?: string;
  minAmount?: string;
  maxAmount?: string;
}

export interface TransactionImportStatus {
  id: UUID;
  status: 'queued' | 'running' | 'partial' | 'completed' | 'failed';
  total_records: number;
  imported_count: number;
  duplicate_count: number;
  error_count: number;
  warning_count: number;
  result_summary: Record<string, unknown> | null;
  error_summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
