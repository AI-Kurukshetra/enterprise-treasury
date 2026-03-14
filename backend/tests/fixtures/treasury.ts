import type { Payment } from '@/types/payments/types';
import type { Transaction } from '@/types/transactions/types';
import type { PendingApprovalItem } from '@/types/approvals/types';

export function fixtureUuid(seed: number): string {
  return `00000000-0000-4000-8000-${seed.toString().padStart(12, '0')}`;
}

export function organizationFixture(overrides: Partial<{ id: string; name: string; baseCurrency: string }> = {}) {
  return {
    id: overrides.id ?? fixtureUuid(1),
    name: overrides.name ?? 'Atlas Treasury Holdings',
    baseCurrency: overrides.baseCurrency ?? 'USD'
  };
}

export function userFixture(overrides: Partial<{ id: string; email: string; displayName: string }> = {}) {
  return {
    id: overrides.id ?? fixtureUuid(101),
    email: overrides.email ?? 'treasurer@example.com',
    displayName: overrides.displayName ?? 'Taylor Treasurer'
  };
}

export function bankAccountFixture(
  overrides: Partial<{
    id: string;
    organization_id: string;
    bank_connection_id: string;
    account_name: string;
    account_number_masked: string;
    currency_code: string;
    region: string | null;
    liquidity_type: 'operating' | 'reserve';
    withdrawal_restricted: boolean;
    current_balance: string | null;
    available_balance: string | null;
    restricted_balance: string | null;
    reconciliation_status: 'reconciled' | 'attention' | 'no_activity';
    status: 'active' | 'dormant' | 'closed';
    created_at: string;
    updated_at: string;
  }> = {}
) {
  return {
    id: overrides.id ?? fixtureUuid(201),
    organization_id: overrides.organization_id ?? fixtureUuid(1),
    bank_connection_id: overrides.bank_connection_id ?? fixtureUuid(301),
    account_name: overrides.account_name ?? 'Operating Account',
    account_number_masked: overrides.account_number_masked ?? '****6789',
    currency_code: overrides.currency_code ?? 'USD',
    region: overrides.region ?? 'North America',
    liquidity_type: overrides.liquidity_type ?? 'operating',
    withdrawal_restricted: overrides.withdrawal_restricted ?? false,
    current_balance: overrides.current_balance ?? '950000.000000',
    available_balance: overrides.available_balance ?? '900000.000000',
    restricted_balance: overrides.restricted_balance ?? '50000.000000',
    reconciliation_status: overrides.reconciliation_status ?? 'reconciled',
    status: overrides.status ?? 'active',
    created_at: overrides.created_at ?? '2026-03-14T09:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-03-14T09:00:00.000Z'
  };
}

export function paymentFixture(overrides: Partial<Payment> = {}): Payment {
  return {
    id: overrides.id ?? fixtureUuid(401),
    organization_id: overrides.organization_id ?? fixtureUuid(1),
    payment_reference: overrides.payment_reference ?? 'PAY-20260314-0001',
    source_account_id: overrides.source_account_id ?? fixtureUuid(201),
    beneficiary_counterparty_id: overrides.beneficiary_counterparty_id ?? fixtureUuid(501),
    amount: overrides.amount ?? '125000.120000',
    currency_code: overrides.currency_code ?? 'USD',
    value_date: overrides.value_date ?? '2026-03-15',
    purpose: overrides.purpose ?? 'Vendor settlement',
    notes: overrides.notes ?? null,
    status: overrides.status ?? 'pending_approval',
    idempotency_key: overrides.idempotency_key ?? 'idem-pay-001',
    request_id: overrides.request_id ?? 'req-001',
    created_by: overrides.created_by ?? fixtureUuid(101),
    approval_workflow_id: overrides.approval_workflow_id ?? fixtureUuid(601),
    approved_at: overrides.approved_at ?? null,
    executed_at: overrides.executed_at ?? null,
    failure_reason: overrides.failure_reason ?? null,
    policy_warnings: overrides.policy_warnings ?? [],
    version: overrides.version ?? 1,
    updated_at: overrides.updated_at ?? '2026-03-14T09:00:00.000Z',
    created_at: overrides.created_at ?? '2026-03-14T09:00:00.000Z'
  };
}

export function transactionFixture(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id ?? fixtureUuid(701),
    organization_id: overrides.organization_id ?? fixtureUuid(1),
    bank_account_id: overrides.bank_account_id ?? fixtureUuid(201),
    booking_date: overrides.booking_date ?? '2026-03-14',
    value_date: overrides.value_date ?? '2026-03-14',
    amount: overrides.amount ?? '125000.120000',
    currency_code: overrides.currency_code ?? 'USD',
    direction: overrides.direction ?? 'outflow',
    description: overrides.description ?? 'ACH Vendor Payment',
    reconciliation_status: overrides.reconciliation_status ?? 'unreconciled',
    dedupe_hash: overrides.dedupe_hash ?? 'dedupe-hash-0000001',
    created_at: overrides.created_at ?? '2026-03-14T09:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-03-14T09:00:00.000Z'
  };
}

export function pendingApprovalFixture(overrides: Partial<PendingApprovalItem> = {}): PendingApprovalItem {
  return {
    paymentId: overrides.paymentId ?? fixtureUuid(401),
    paymentReference: overrides.paymentReference ?? 'PAY-20260314-0001',
    amount: overrides.amount ?? '125000.120000',
    currencyCode: overrides.currencyCode ?? 'USD',
    valueDate: overrides.valueDate ?? '2026-03-15',
    createdAt: overrides.createdAt ?? '2026-03-14T09:00:00.000Z',
    rowVersionToken: overrides.rowVersionToken ?? '1'
  };
}

export function cashPositionFixture(
  overrides: Partial<{
    id: string;
    organization_id: string;
    as_of_at: string;
    scope_type: 'account' | 'entity' | 'organization';
    scope_id: string | null;
    currency_code: string;
    available_balance: string;
    current_balance: string;
    source_version: string;
  }> = {}
) {
  return {
    id: overrides.id ?? fixtureUuid(801),
    organization_id: overrides.organization_id ?? fixtureUuid(1),
    as_of_at: overrides.as_of_at ?? '2026-03-14T09:00:00.000Z',
    scope_type: overrides.scope_type ?? 'organization',
    scope_id: overrides.scope_id ?? null,
    currency_code: overrides.currency_code ?? 'USD',
    available_balance: overrides.available_balance ?? '900000.000000',
    current_balance: overrides.current_balance ?? '950000.000000',
    source_version: overrides.source_version ?? 'snapshot-1'
  };
}
