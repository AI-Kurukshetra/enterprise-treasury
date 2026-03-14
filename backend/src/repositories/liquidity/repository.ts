import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthorizationError } from '@/errors/AuthorizationError';
import { assertNoQueryError } from '@/repositories/base/execute';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import type {
  CreateIntercompanyLoanInput,
  CreatePoolInput,
  CreateSweepingRuleInput,
  ListPoolsQuery,
  UpdatePoolInput
} from '@/schemas/liquidity/schema';
import type {
  IntercompanyTransaction,
  LiquidityPool,
  LiquidityPoolAccount,
  SweepingRule
} from '@/types/liquidity/types';

interface BankAccountRow {
  id: string;
  organization_id: string;
  account_name: string;
  account_number_masked: string;
  currency_code: string;
  country_code: string | null;
  status: 'active' | 'dormant' | 'closed';
}

interface CashPositionLatestRow {
  scope_id: string | null;
  as_of_at: string;
  available_balance: string;
  current_balance: string;
}

interface LiquidityPoolAccountRow {
  id: string;
  organization_id: string;
  liquidity_pool_id: string;
  bank_account_id: string;
  priority: number;
  created_at: string;
  updated_at: string;
}

interface SweepAuditRow {
  entity_id: string | null;
  occurred_at: string;
}

interface TransactionSourceEventRow {
  transaction_id: string;
}

export interface LiquidityAccountSnapshot {
  pool: LiquidityPool;
  account: LiquidityPoolAccount;
}

export interface PoolAggregateRow {
  pool: LiquidityPool;
  account_count: number;
  active_rule_count: number;
}

export interface SweepExecutionPersistenceInput {
  poolId: string;
  ruleId: string;
  sourceAccountId: string;
  targetAccountId: string;
  currencyCode: string;
  transferAmount: string;
  sourceBefore: { available_balance: string; current_balance: string };
  sourceAfter: { available_balance: string; current_balance: string };
  targetBefore: { available_balance: string; current_balance: string };
  targetAfter: { available_balance: string; current_balance: string };
  executedAt: string;
  actorUserId: string;
  requestId: string;
}

export class LiquidityRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async listPools(orgId: string, filters: ListPoolsQuery): Promise<PoolAggregateRow[]> {
    this.assertTenant(orgId);

    let poolQuery = this.db
      .from('liquidity_pools')
      .select('id,organization_id,name,pool_type,base_currency,created_at,updated_at')
      .eq('organization_id', orgId)
      .order('name', { ascending: true });

    if (filters.poolType) {
      poolQuery = poolQuery.eq('pool_type', filters.poolType);
    }
    if (filters.baseCurrency) {
      poolQuery = poolQuery.eq('base_currency', filters.baseCurrency);
    }

    const { data: poolData, error: poolError } = await poolQuery;
    assertNoQueryError(poolError);

    const pools = (poolData ?? []) as LiquidityPool[];
    if (pools.length === 0) {
      return [];
    }

    const poolIds = pools.map((pool) => pool.id);
    const [{ data: accountLinks, error: accountLinksError }, { data: ruleRows, error: ruleError }] = await Promise.all([
      this.db
        .from('liquidity_pool_accounts')
        .select('liquidity_pool_id')
        .eq('organization_id', orgId)
        .in('liquidity_pool_id', poolIds),
      this.db
        .from('sweeping_rules')
        .select('liquidity_pool_id,is_active')
        .eq('organization_id', orgId)
        .in('liquidity_pool_id', poolIds)
    ]);

    assertNoQueryError(accountLinksError);
    assertNoQueryError(ruleError);

    const accountCountByPool = new Map<string, number>();
    for (const row of (accountLinks ?? []) as Array<{ liquidity_pool_id: string }>) {
      accountCountByPool.set(row.liquidity_pool_id, (accountCountByPool.get(row.liquidity_pool_id) ?? 0) + 1);
    }

    const activeRuleCountByPool = new Map<string, number>();
    for (const row of (ruleRows ?? []) as Array<{ liquidity_pool_id: string; is_active: boolean }>) {
      if (row.is_active) {
        activeRuleCountByPool.set(row.liquidity_pool_id, (activeRuleCountByPool.get(row.liquidity_pool_id) ?? 0) + 1);
      }
    }

    return pools.map((pool) => ({
      pool,
      account_count: accountCountByPool.get(pool.id) ?? 0,
      active_rule_count: activeRuleCountByPool.get(pool.id) ?? 0
    }));
  }

  async getPool(orgId: string, poolId: string): Promise<LiquidityPool | null> {
    this.assertTenant(orgId);

    const { data, error } = await this.db
      .from('liquidity_pools')
      .select('id,organization_id,name,pool_type,base_currency,created_at,updated_at')
      .eq('organization_id', orgId)
      .eq('id', poolId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as LiquidityPool | null) ?? null;
  }

  async getPoolAccounts(orgId: string, poolId: string): Promise<LiquidityPoolAccount[]> {
    this.assertTenant(orgId);

    const { data: linkData, error: linkError } = await this.db
      .from('liquidity_pool_accounts')
      .select('id,organization_id,liquidity_pool_id,bank_account_id,priority,created_at,updated_at')
      .eq('organization_id', orgId)
      .eq('liquidity_pool_id', poolId)
      .order('priority', { ascending: true });

    assertNoQueryError(linkError);
    const links = (linkData ?? []) as LiquidityPoolAccountRow[];
    if (links.length === 0) {
      return [];
    }

    const accountIds = links.map((row) => row.bank_account_id);
    const [{ data: accountData, error: accountError }, { data: positionData, error: positionError }] = await Promise.all([
      this.db
        .from('bank_accounts')
        .select('id,organization_id,account_name,account_number_masked,currency_code,country_code,status')
        .eq('organization_id', orgId)
        .in('id', accountIds),
      this.db
        .from('cash_positions_latest')
        .select('scope_id,as_of_at,available_balance,current_balance')
        .eq('organization_id', orgId)
        .eq('scope_type', 'account')
        .in('scope_id', accountIds)
    ]);

    assertNoQueryError(accountError);
    assertNoQueryError(positionError);

    const accountsById = new Map(((accountData ?? []) as BankAccountRow[]).map((row) => [row.id, row]));
    const positionsByAccountId = new Map(
      ((positionData ?? []) as CashPositionLatestRow[])
        .filter((row) => row.scope_id)
        .map((row) => [row.scope_id!, row])
    );

    return links.map((row) => {
      const account = accountsById.get(row.bank_account_id);
      const position = positionsByAccountId.get(row.bank_account_id);

      return {
        ...row,
        account_name: account?.account_name,
        account_number_masked: account?.account_number_masked,
        currency_code: account?.currency_code,
        country_code: account?.country_code ?? null,
        status: account?.status,
        available_balance: position?.available_balance ?? '0.000000',
        current_balance: position?.current_balance ?? '0.000000',
        as_of_at: position?.as_of_at ?? null
      };
    });
  }

  async createPool(orgId: string, input: CreatePoolInput): Promise<LiquidityPool> {
    this.assertTenant(orgId);

    const { data, error } = await this.db
      .from('liquidity_pools')
      .insert({
        organization_id: orgId,
        name: input.name,
        pool_type: input.poolType,
        base_currency: input.baseCurrency
      })
      .select('id,organization_id,name,pool_type,base_currency,created_at,updated_at')
      .single();

    assertNoQueryError(error);
    const pool = data as LiquidityPool;

    const { error: linkError } = await this.db.from('liquidity_pool_accounts').insert(
      input.accounts.map((account, index) => ({
        organization_id: orgId,
        liquidity_pool_id: pool.id,
        bank_account_id: account.bankAccountId,
        priority: account.priority ?? index + 1
      }))
    );

    assertNoQueryError(linkError);
    return pool;
  }

  async updatePool(orgId: string, poolId: string, input: UpdatePoolInput): Promise<LiquidityPool | null> {
    this.assertTenant(orgId);

    const payload: Record<string, unknown> = {};
    if (input.name) {
      payload.name = input.name;
    }
    if (input.poolType) {
      payload.pool_type = input.poolType;
    }
    if (input.baseCurrency) {
      payload.base_currency = input.baseCurrency;
    }

    let pool: LiquidityPool | null = null;
    if (Object.keys(payload).length > 0) {
      const { data, error } = await this.db
        .from('liquidity_pools')
        .update(payload)
        .eq('organization_id', orgId)
        .eq('id', poolId)
        .select('id,organization_id,name,pool_type,base_currency,created_at,updated_at')
        .maybeSingle();

      assertNoQueryError(error);
      pool = (data as LiquidityPool | null) ?? null;
    } else {
      pool = await this.getPool(orgId, poolId);
    }

    if (pool && input.accounts) {
      const { error: deleteError } = await this.db
        .from('liquidity_pool_accounts')
        .delete()
        .eq('organization_id', orgId)
        .eq('liquidity_pool_id', poolId);

      assertNoQueryError(deleteError);

      const { error: insertError } = await this.db.from('liquidity_pool_accounts').insert(
        input.accounts.map((account, index) => ({
          organization_id: orgId,
          liquidity_pool_id: poolId,
          bank_account_id: account.bankAccountId,
          priority: account.priority ?? index + 1
        }))
      );

      assertNoQueryError(insertError);
    }

    return pool;
  }

  async listSweepingRules(orgId: string, poolId?: string): Promise<SweepingRule[]> {
    this.assertTenant(orgId);

    let query = this.db
      .from('sweeping_rules')
      .select(
        'id,organization_id,liquidity_pool_id,rule_name,source_account_id,target_account_id,min_balance,target_balance,max_transfer,frequency,is_active,created_at,updated_at'
      )
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (poolId) {
      query = query.eq('liquidity_pool_id', poolId);
    }

    const { data, error } = await query;
    assertNoQueryError(error);
    return (data ?? []) as SweepingRule[];
  }

  async getSweepingRule(orgId: string, ruleId: string): Promise<SweepingRule | null> {
    this.assertTenant(orgId);

    const { data, error } = await this.db
      .from('sweeping_rules')
      .select(
        'id,organization_id,liquidity_pool_id,rule_name,source_account_id,target_account_id,min_balance,target_balance,max_transfer,frequency,is_active,created_at,updated_at'
      )
      .eq('organization_id', orgId)
      .eq('id', ruleId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as SweepingRule | null) ?? null;
  }

  async getPoolRules(orgId: string, poolId: string): Promise<SweepingRule[]> {
    this.assertTenant(orgId);

    const { data, error } = await this.db
      .from('sweeping_rules')
      .select(
        'id,organization_id,liquidity_pool_id,rule_name,source_account_id,target_account_id,min_balance,target_balance,max_transfer,frequency,is_active,created_at,updated_at'
      )
      .eq('organization_id', orgId)
      .eq('liquidity_pool_id', poolId)
      .order('created_at', { ascending: false });

    assertNoQueryError(error);
    return (data ?? []) as SweepingRule[];
  }

  async createSweepingRule(orgId: string, input: CreateSweepingRuleInput): Promise<SweepingRule> {
    this.assertTenant(orgId);

    const { data, error } = await this.db
      .from('sweeping_rules')
      .insert({
        organization_id: orgId,
        liquidity_pool_id: input.poolId,
        rule_name: input.ruleName,
        source_account_id: input.sourceAccountId,
        target_account_id: input.targetAccountId,
        min_balance: input.minBalance,
        target_balance: input.targetBalance,
        max_transfer: input.maxTransfer,
        frequency: input.frequency,
        is_active: input.isActive ?? true
      })
      .select(
        'id,organization_id,liquidity_pool_id,rule_name,source_account_id,target_account_id,min_balance,target_balance,max_transfer,frequency,is_active,created_at,updated_at'
      )
      .single();

    assertNoQueryError(error);
    return data as SweepingRule;
  }

  async updateSweepingRule(
    orgId: string,
    ruleId: string,
    input: Partial<CreateSweepingRuleInput> & { isActive?: boolean }
  ): Promise<SweepingRule | null> {
    this.assertTenant(orgId);

    const payload: Record<string, unknown> = {};
    if (input.poolId) {
      payload.liquidity_pool_id = input.poolId;
    }
    if (input.ruleName) {
      payload.rule_name = input.ruleName;
    }
    if (input.sourceAccountId) {
      payload.source_account_id = input.sourceAccountId;
    }
    if (input.targetAccountId) {
      payload.target_account_id = input.targetAccountId;
    }
    if (input.minBalance) {
      payload.min_balance = input.minBalance;
    }
    if (input.targetBalance) {
      payload.target_balance = input.targetBalance;
    }
    if (input.maxTransfer) {
      payload.max_transfer = input.maxTransfer;
    }
    if (input.frequency) {
      payload.frequency = input.frequency;
    }
    if (typeof input.isActive === 'boolean') {
      payload.is_active = input.isActive;
    }

    const { data, error } = await this.db
      .from('sweeping_rules')
      .update(payload)
      .eq('organization_id', orgId)
      .eq('id', ruleId)
      .select(
        'id,organization_id,liquidity_pool_id,rule_name,source_account_id,target_account_id,min_balance,target_balance,max_transfer,frequency,is_active,created_at,updated_at'
      )
      .maybeSingle();

    assertNoQueryError(error);
    return (data as SweepingRule | null) ?? null;
  }

  async getLiquidityPosition(orgId: string): Promise<LiquidityAccountSnapshot[]> {
    this.assertTenant(orgId);

    const { data: poolData, error: poolError } = await this.db
      .from('liquidity_pools')
      .select('id,organization_id,name,pool_type,base_currency,created_at,updated_at')
      .eq('organization_id', orgId)
      .order('name', { ascending: true });

    assertNoQueryError(poolError);
    const pools = (poolData ?? []) as LiquidityPool[];
    if (pools.length === 0) {
      return [];
    }

    const poolById = new Map(pools.map((pool) => [pool.id, pool]));
    const poolIds = pools.map((pool) => pool.id);
    const { data: accountData, error: accountError } = await this.db
      .from('liquidity_pool_accounts')
      .select('id,organization_id,liquidity_pool_id,bank_account_id,priority,created_at,updated_at')
      .eq('organization_id', orgId)
      .in('liquidity_pool_id', poolIds)
      .order('priority', { ascending: true });

    assertNoQueryError(accountError);
    const links = (accountData ?? []) as LiquidityPoolAccountRow[];
    if (links.length === 0) {
      return [];
    }

    const bankAccountIds = links.map((row) => row.bank_account_id);
    const [{ data: bankAccountData, error: bankAccountError }, { data: cashData, error: cashError }] = await Promise.all([
      this.db
        .from('bank_accounts')
        .select('id,organization_id,account_name,account_number_masked,currency_code,country_code,status')
        .eq('organization_id', orgId)
        .in('id', bankAccountIds),
      this.db
        .from('cash_positions_latest')
        .select('scope_id,as_of_at,available_balance,current_balance')
        .eq('organization_id', orgId)
        .eq('scope_type', 'account')
        .in('scope_id', bankAccountIds)
    ]);

    assertNoQueryError(bankAccountError);
    assertNoQueryError(cashError);

    const accountById = new Map(((bankAccountData ?? []) as BankAccountRow[]).map((row) => [row.id, row]));
    const cashByScopeId = new Map(
      ((cashData ?? []) as CashPositionLatestRow[])
        .filter((row) => row.scope_id)
        .map((row) => [row.scope_id!, row])
    );

    return links.flatMap((row) => {
      const pool = poolById.get(row.liquidity_pool_id);
      if (!pool) {
        return [];
      }

      const bankAccount = accountById.get(row.bank_account_id);
      const position = cashByScopeId.get(row.bank_account_id);

      return [
        {
          pool,
          account: {
            ...row,
            account_name: bankAccount?.account_name,
            account_number_masked: bankAccount?.account_number_masked,
            currency_code: bankAccount?.currency_code,
            country_code: bankAccount?.country_code ?? null,
            status: bankAccount?.status,
            available_balance: position?.available_balance ?? '0.000000',
            current_balance: position?.current_balance ?? '0.000000',
            as_of_at: position?.as_of_at ?? null
          }
        }
      ];
    });
  }

  async getAccountsByIds(orgId: string, accountIds: string[]): Promise<BankAccountRow[]> {
    this.assertTenant(orgId);
    if (accountIds.length === 0) {
      return [];
    }

    const { data, error } = await this.db
      .from('bank_accounts')
      .select('id,organization_id,account_name,account_number_masked,currency_code,country_code,status')
      .eq('organization_id', orgId)
      .in('id', accountIds);

    assertNoQueryError(error);
    return (data ?? []) as BankAccountRow[];
  }

  async createIntercompanyLoan(orgId: string, input: CreateIntercompanyLoanInput): Promise<IntercompanyTransaction> {
    this.assertTenant(orgId);

    const { data, error } = await this.db
      .from('intercompany_transactions')
      .insert({
        organization_id: orgId,
        lender_entity_id: input.lenderEntityId,
        borrower_entity_id: input.borrowerEntityId,
        amount: input.amount,
        currency_code: input.currencyCode,
        interest_rate: input.interestRate ?? null,
        maturity_date: input.maturityDate ?? null,
        status: 'proposed'
      })
      .select('id,organization_id,lender_entity_id,borrower_entity_id,amount,currency_code,interest_rate,status,maturity_date,created_at,updated_at')
      .single();

    assertNoQueryError(error);
    return data as IntercompanyTransaction;
  }

  async listIntercompanyLoans(orgId: string, status?: IntercompanyTransaction['status']): Promise<IntercompanyTransaction[]> {
    this.assertTenant(orgId);

    let query = this.db
      .from('intercompany_transactions')
      .select('id,organization_id,lender_entity_id,borrower_entity_id,amount,currency_code,interest_rate,status,maturity_date,created_at,updated_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    assertNoQueryError(error);
    return (data ?? []) as IntercompanyTransaction[];
  }

  async getIntercompanyLoan(orgId: string, loanId: string): Promise<IntercompanyTransaction | null> {
    this.assertTenant(orgId);

    const { data, error } = await this.db
      .from('intercompany_transactions')
      .select('id,organization_id,lender_entity_id,borrower_entity_id,amount,currency_code,interest_rate,status,maturity_date,created_at,updated_at')
      .eq('organization_id', orgId)
      .eq('id', loanId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as IntercompanyTransaction | null) ?? null;
  }

  async settleIntercompanyLoan(orgId: string, loanId: string): Promise<IntercompanyTransaction | null> {
    this.assertTenant(orgId);

    const { data, error } = await this.db
      .from('intercompany_transactions')
      .update({ status: 'settled' })
      .eq('organization_id', orgId)
      .eq('id', loanId)
      .select('id,organization_id,lender_entity_id,borrower_entity_id,amount,currency_code,interest_rate,status,maturity_date,created_at,updated_at')
      .maybeSingle();

    assertNoQueryError(error);
    return (data as IntercompanyTransaction | null) ?? null;
  }

  async listRecentSweepEvents(orgId: string, ruleIds: string[]): Promise<SweepAuditRow[]> {
    this.assertTenant(orgId);
    if (ruleIds.length === 0) {
      return [];
    }

    const { data, error } = await this.db
      .from('audit_logs')
      .select('entity_id,occurred_at')
      .eq('organization_id', orgId)
      .eq('action', 'liquidity.sweep.executed')
      .eq('entity_type', 'sweeping_rules')
      .in('entity_id', ruleIds)
      .order('occurred_at', { ascending: false });

    assertNoQueryError(error);
    return (data ?? []) as SweepAuditRow[];
  }

  async hasSweepExecution(orgId: string, ruleId: string, executionDate: string): Promise<boolean> {
    this.assertTenant(orgId);

    const { data, error } = await this.db
      .from('transaction_source_events')
      .select('transaction_id')
      .eq('organization_id', orgId)
      .eq('source_system', 'liquidity_sweep')
      .eq('source_event_id', `sweep:${ruleId}:${executionDate}:out`)
      .maybeSingle();

    assertNoQueryError(error);
    return Boolean((data as TransactionSourceEventRow | null) ?? null);
  }

  async persistSweepExecution(orgId: string, input: SweepExecutionPersistenceInput): Promise<void> {
    this.assertTenant(orgId);

    const bookingDate = input.executedAt.slice(0, 10);
    const sharedPayload = {
      organization_id: orgId,
      source_type: 'manual_adjustment' as const,
      source_system: 'liquidity_sweep',
      event_timestamp: input.executedAt,
      booking_date: bookingDate,
      value_date: bookingDate,
      currency_code: input.currencyCode,
      category: 'liquidity_sweep',
      raw_payload: {
        poolId: input.poolId,
        ruleId: input.ruleId,
        requestId: input.requestId
      }
    };

    const { error: transactionError } = await this.db.from('transactions').insert([
      {
        ...sharedPayload,
        bank_account_id: input.sourceAccountId,
        source_event_id: `sweep:${input.ruleId}:${bookingDate}:out`,
        amount: input.transferAmount,
        direction: 'outflow',
        description: `Liquidity sweep ${input.ruleId} source leg`,
        dedupe_hash: `liquidity-sweep:${input.ruleId}:${bookingDate}:out`
      },
      {
        ...sharedPayload,
        bank_account_id: input.targetAccountId,
        source_event_id: `sweep:${input.ruleId}:${bookingDate}:in`,
        amount: input.transferAmount,
        direction: 'inflow',
        description: `Liquidity sweep ${input.ruleId} target leg`,
        dedupe_hash: `liquidity-sweep:${input.ruleId}:${bookingDate}:in`
      }
    ]);

    assertNoQueryError(transactionError);

    const { error: cashError } = await this.db.from('cash_positions').insert([
      {
        organization_id: orgId,
        as_of_at: input.executedAt,
        scope_type: 'account',
        scope_id: input.sourceAccountId,
        currency_code: input.currencyCode,
        available_balance: input.sourceAfter.available_balance,
        current_balance: input.sourceAfter.current_balance,
        source_version: `liquidity-sweep:${input.ruleId}:${input.executedAt}:source`
      },
      {
        organization_id: orgId,
        as_of_at: input.executedAt,
        scope_type: 'account',
        scope_id: input.targetAccountId,
        currency_code: input.currencyCode,
        available_balance: input.targetAfter.available_balance,
        current_balance: input.targetAfter.current_balance,
        source_version: `liquidity-sweep:${input.ruleId}:${input.executedAt}:target`
      }
    ]);

    assertNoQueryError(cashError);

    const { error: auditError } = await this.db.from('audit_logs').insert({
      organization_id: orgId,
      user_id: input.actorUserId,
      action: 'liquidity.sweep.executed',
      entity_type: 'sweeping_rules',
      entity_id: input.ruleId,
      previous_state: {
        source: input.sourceBefore,
        target: input.targetBefore
      },
      new_state: {
        source: input.sourceAfter,
        target: input.targetAfter,
        transfer_amount: input.transferAmount
      },
      request_id: input.requestId,
      source_channel: 'service',
      metadata: {
        poolId: input.poolId,
        sourceAccountId: input.sourceAccountId,
        targetAccountId: input.targetAccountId,
        executedAt: input.executedAt
      }
    });

    assertNoQueryError(auditError);
  }

  private assertTenant(orgId: string) {
    if (orgId !== this.context.organizationId) {
      throw new AuthorizationError('Repository organization context mismatch');
    }
  }
}
