import type { PaginationInput } from '@/types/common';
import { NotFoundError } from '@/errors/NotFoundError';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { assertNoQueryError } from '@/repositories/base/execute';
import { AccountsRepository } from '@/repositories/accounts/repository';
import type { AccountFilters, CreateAccountInput, UpdateAccountInput } from '@/types/accounts/types';
import type { ServiceContext } from '@/services/context';
import { CashPositionAggregationService } from '@/services/cash-positions/aggregation-service';

const DEFAULT_ACCOUNT_METADATA = {
  region: null,
  liquidity_type: 'operating' as const,
  withdrawal_restricted: false
};

function normalizeAccountMetadata<T extends Record<string, unknown>>(account: T) {
  return {
    ...DEFAULT_ACCOUNT_METADATA,
    ...account,
    region: (account.region as string | null | undefined) ?? null,
    liquidity_type: (account.liquidity_type as 'operating' | 'reserve' | undefined) ?? 'operating',
    withdrawal_restricted: (account.withdrawal_restricted as boolean | undefined) ?? false
  };
}

export class AccountsService {
  private readonly repository: AccountsRepository;
  private readonly aggregationService: CashPositionAggregationService;
  private readonly organizationId: string;

  constructor(context: ServiceContext, repository?: AccountsRepository) {
    this.organizationId = context.organizationId;
    this.repository = repository ?? new AccountsRepository({ organizationId: context.organizationId });
    this.aggregationService = new CashPositionAggregationService(context.organizationId);
  }

  async list(filters: AccountFilters, pagination: PaginationInput) {
    const result = await this.repository.list(filters, pagination);
    if (result.items.length === 0) {
      return result;
    }

    const accountIds = result.items.map((account) => account.id);
    const [latestPositions, reconciliationRows] = await Promise.all([
      this.aggregationService.getLatestAccountPositions(this.organizationId, accountIds),
      fetchAccountReconciliationStatus(this.organizationId, accountIds)
    ]);

    const positionsByAccountId = new Map(latestPositions.map((position) => [position.scope_id, position]));
    const reconciliationByAccountId = buildReconciliationStatusMap(reconciliationRows);

    return {
      ...result,
      items: result.items.map((account) => {
        const position = positionsByAccountId.get(account.id);
        return {
          ...normalizeAccountMetadata(account),
          current_balance: position?.current_balance ?? '0.000000',
          available_balance: position?.available_balance ?? '0.000000',
          restricted_balance: position?.restricted_balance ?? '0.000000',
          reconciliation_status: reconciliationByAccountId.get(account.id) ?? 'no_activity'
        };
      })
    };
  }

  create(input: CreateAccountInput) {
    return this.repository.create(input).then((account) => normalizeAccountMetadata(account));
  }

  async getById(accountId: string) {
    const account = await this.repository.getById(accountId);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    return normalizeAccountMetadata(account);
  }

  async update(accountId: string, input: UpdateAccountInput) {
    const account = await this.repository.update(accountId, input);
    if (!account) {
      throw new NotFoundError('Account not found');
    }
    return normalizeAccountMetadata(account);
  }
}

async function fetchAccountReconciliationStatus(organizationId: string, accountIds: string[]) {
  const db = createServiceSupabaseClient();
  const { data, error } = await db
    .from('transactions')
    .select('bank_account_id,reconciliation_status')
    .eq('organization_id', organizationId)
    .in('bank_account_id', accountIds);

  assertNoQueryError(error);
  return (data ?? []) as Array<{
    bank_account_id: string;
    reconciliation_status: 'unreconciled' | 'partially_reconciled' | 'reconciled' | 'exception';
  }>;
}

function buildReconciliationStatusMap(
  rows: Array<{
    bank_account_id: string;
    reconciliation_status: 'unreconciled' | 'partially_reconciled' | 'reconciled' | 'exception';
  }>
) {
  const summary = new Map<
    string,
    {
      hasActivity: boolean;
      hasUnreconciled: boolean;
    }
  >();

  for (const row of rows) {
    const current = summary.get(row.bank_account_id) ?? {
      hasActivity: false,
      hasUnreconciled: false
    };
    current.hasActivity = true;
    current.hasUnreconciled = current.hasUnreconciled || row.reconciliation_status !== 'reconciled';
    summary.set(row.bank_account_id, current);
  }

  const statusMap = new Map<string, 'reconciled' | 'attention' | 'no_activity'>();
  for (const [accountId, value] of summary) {
    statusMap.set(accountId, value.hasUnreconciled ? 'attention' : value.hasActivity ? 'reconciled' : 'no_activity');
  }
  return statusMap;
}
