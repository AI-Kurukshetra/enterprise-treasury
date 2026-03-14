import type { UUID } from '@/types/common';

export interface Account {
  id: UUID;
  organization_id: UUID;
  bank_connection_id: UUID | null;
  account_name: string;
  account_number_masked: string;
  currency_code: string;
  region: string | null;
  liquidity_type: 'operating' | 'reserve';
  withdrawal_restricted: boolean;
  current_balance?: string | null;
  available_balance?: string | null;
  restricted_balance?: string | null;
  reconciliation_status?: 'reconciled' | 'attention' | 'no_activity';
  status: 'active' | 'dormant' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface AccountFilters {
  status?: Account['status'];
  currencyCode?: string;
  bankConnectionId?: UUID;
}

export interface CreateAccountInput {
  bankConnectionId: UUID;
  accountName: string;
  accountNumberMasked: string;
  currencyCode: string;
}

export interface UpdateAccountInput {
  accountName?: string;
  status?: Account['status'];
}
