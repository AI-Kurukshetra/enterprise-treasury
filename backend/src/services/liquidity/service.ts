import { ConflictError } from '@/errors/ConflictError';
import { NotFoundError } from '@/errors/NotFoundError';
import { ValidationError } from '@/errors/ValidationError';
import { withTransactionBoundary } from '@/lib/transaction';
import { LiquidityRepository } from '@/repositories/liquidity/repository';
import type {
  CreateIntercompanyLoanInput,
  CreatePoolInput,
  CreateSweepingRuleInput,
  ListPoolsQuery,
  LiquidityPositionQuery,
  UpdatePoolInput
} from '@/schemas/liquidity/schema';
import type { ServiceContext } from '@/services/context';
import type {
  ConcentrationAnalysis,
  ConcentrationBucket,
  IntercompanyTransaction,
  LiquidityPoolDetail,
  LiquidityPosition,
  LiquidityPositionResponse,
  PoolSummary,
  SweepExecutionResult,
  SweepingRule
} from '@/types/liquidity/types';
import {
  addAmounts,
  compareDecimalStrings,
  decimalToScaledInteger,
  isPositiveDecimalString,
  maxDecimalString,
  minDecimalString,
  scaledIntegerToAmount,
  subtractAmounts,
  sumDecimalStrings
} from '@/utils/money';

const REGION_BY_COUNTRY: Record<string, string> = {
  US: 'Americas',
  CA: 'Americas',
  MX: 'LATAM',
  BR: 'LATAM',
  GB: 'EMEA',
  DE: 'EMEA',
  FR: 'EMEA',
  NL: 'EMEA',
  AE: 'EMEA',
  SG: 'APAC',
  CN: 'APAC',
  JP: 'APAC',
  AU: 'APAC',
  IN: 'APAC'
};

interface PositionAccumulator {
  position: LiquidityPosition;
}

export class LiquidityService {
  private readonly context: ServiceContext;
  private readonly repository: LiquidityRepository;

  constructor(context: ServiceContext, repository?: LiquidityRepository) {
    this.context = context;
    this.repository = repository ?? new LiquidityRepository({ organizationId: context.organizationId });
  }

  async listPools(filters: ListPoolsQuery): Promise<PoolSummary[]> {
    const [poolRows, positionResponse, allRules] = await Promise.all([
      this.repository.listPools(this.context.organizationId, filters),
      this.getLiquidityPosition(),
      this.repository.listSweepingRules(this.context.organizationId)
    ]);

    const positionsByPoolId = new Map(positionResponse.pools.map((position) => [position.pool_id, position]));
    const sweepAuditRows = await this.repository.listRecentSweepEvents(
      this.context.organizationId,
      allRules.map((rule) => rule.id)
    );

    const lastSweepByRuleId = new Map<string, string>();
    for (const row of sweepAuditRows) {
      if (row.entity_id && !lastSweepByRuleId.has(row.entity_id)) {
        lastSweepByRuleId.set(row.entity_id, row.occurred_at);
      }
    }

    const rulesByPoolId = new Map<string, SweepingRule[]>();
    for (const rule of allRules) {
      const existing = rulesByPoolId.get(rule.liquidity_pool_id) ?? [];
      existing.push({
        ...rule,
        last_executed_at: lastSweepByRuleId.get(rule.id) ?? null
      });
      rulesByPoolId.set(rule.liquidity_pool_id, existing);
    }

    return poolRows.map(({ pool, account_count, active_rule_count }) => {
      const position = positionsByPoolId.get(pool.id);
      const poolRules = rulesByPoolId.get(pool.id) ?? [];
      const lastSweepAt =
        poolRules
          .map((rule) => rule.last_executed_at)
          .filter((value): value is string => Boolean(value))
          .sort((left, right) => (left > right ? -1 : 1))[0] ?? null;

      return {
        ...pool,
        account_count,
        active_rule_count,
        total_balance: position?.total_balance ?? '0.000000',
        available_balance: position?.available_balance ?? '0.000000',
        trapped_cash: position?.trapped_cash ?? '0.000000',
        last_sweep_at: lastSweepAt
      };
    });
  }

  async getPool(poolId: string): Promise<LiquidityPoolDetail> {
    const [pool, accounts, rules] = await Promise.all([
      this.repository.getPool(this.context.organizationId, poolId),
      this.repository.getPoolAccounts(this.context.organizationId, poolId),
      this.repository.getPoolRules(this.context.organizationId, poolId)
    ]);

    if (!pool) {
      throw new NotFoundError('Liquidity pool not found');
    }

    const activeRules = rules.filter((rule) => rule.is_active);
    const recentSweepRows = await this.repository.listRecentSweepEvents(
      this.context.organizationId,
      activeRules.map((rule) => rule.id)
    );

    const lastSweepByRuleId = new Map<string, string>();
    for (const row of recentSweepRows) {
      if (row.entity_id && !lastSweepByRuleId.has(row.entity_id)) {
        lastSweepByRuleId.set(row.entity_id, row.occurred_at);
      }
    }

    const totalBalance = sumDecimalStrings(accounts.map((account) => account.current_balance ?? '0.000000'));
    const availableBalance = sumDecimalStrings(accounts.map((account) => account.available_balance ?? '0.000000'));
    const trappedCash = maxDecimalString(subtractAmounts(totalBalance, availableBalance), '0.000000');
    const lastSweepAt =
      activeRules
        .map((rule) => lastSweepByRuleId.get(rule.id))
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => (left > right ? -1 : 1))[0] ?? null;

    const summary: PoolSummary = {
      ...pool,
      account_count: accounts.length,
      active_rule_count: activeRules.length,
      total_balance: totalBalance,
      available_balance: availableBalance,
      trapped_cash: trappedCash,
      last_sweep_at: lastSweepAt
    };

    return {
      ...pool,
      accounts,
      rules: rules.map((rule) => ({
        ...rule,
        last_executed_at: lastSweepByRuleId.get(rule.id) ?? null
      })),
      summary
    };
  }

  async createPool(input: CreatePoolInput) {
    this.assertUniqueAccounts(input.accounts.map((account) => account.bankAccountId));
    await this.validatePoolAccounts(input.baseCurrency, input.accounts.map((account) => account.bankAccountId));

    const pool = await withTransactionBoundary('liquidity.pools.create', async () =>
      this.repository.createPool(this.context.organizationId, input)
    );

    return this.getPool(pool.id);
  }

  async updatePool(poolId: string, input: UpdatePoolInput) {
    const existing = await this.repository.getPool(this.context.organizationId, poolId);
    if (!existing) {
      throw new NotFoundError('Liquidity pool not found');
    }

    const nextBaseCurrency = input.baseCurrency ?? existing.base_currency;
    if (input.accounts) {
      this.assertUniqueAccounts(input.accounts.map((account) => account.bankAccountId));
      await this.validatePoolAccounts(nextBaseCurrency, input.accounts.map((account) => account.bankAccountId));
    }

    await withTransactionBoundary('liquidity.pools.update', async () =>
      this.repository.updatePool(this.context.organizationId, poolId, input)
    );

    return this.getPool(poolId);
  }

  async listSweepingRules(poolId?: string) {
    const rules = await this.repository.listSweepingRules(this.context.organizationId, poolId);
    const recentSweepRows = await this.repository.listRecentSweepEvents(
      this.context.organizationId,
      rules.map((rule) => rule.id)
    );

    const lastSweepByRuleId = new Map<string, string>();
    for (const row of recentSweepRows) {
      if (row.entity_id && !lastSweepByRuleId.has(row.entity_id)) {
        lastSweepByRuleId.set(row.entity_id, row.occurred_at);
      }
    }

    return rules.map((rule) => ({
      ...rule,
      last_executed_at: lastSweepByRuleId.get(rule.id) ?? null
    }));
  }

  async createRule(input: CreateSweepingRuleInput) {
    if (compareDecimalStrings(input.targetBalance, input.minBalance) < 0) {
      throw new ValidationError('Sweep target balance must be greater than or equal to the minimum balance');
    }
    if (!isPositiveDecimalString(input.maxTransfer)) {
      throw new ValidationError('Sweep max transfer must be positive');
    }
    if (input.sourceAccountId === input.targetAccountId) {
      throw new ValidationError('Sweep source and target accounts must differ');
    }

    const [pool, poolAccounts, accountRows] = await Promise.all([
      this.repository.getPool(this.context.organizationId, input.poolId),
      this.repository.getPoolAccounts(this.context.organizationId, input.poolId),
      this.repository.getAccountsByIds(this.context.organizationId, [input.sourceAccountId, input.targetAccountId])
    ]);

    if (!pool) {
      throw new NotFoundError('Liquidity pool not found');
    }

    const poolAccountIds = new Set(poolAccounts.map((account) => account.bank_account_id));
    if (!poolAccountIds.has(input.sourceAccountId) || !poolAccountIds.has(input.targetAccountId)) {
      throw new ValidationError('Sweep rules can only reference accounts assigned to the selected liquidity pool');
    }

    if (accountRows.length !== 2) {
      throw new ValidationError('Sweep rule accounts must exist inside the current organization');
    }

    const [sourceAccount, targetAccount] = accountRows;
    if (!sourceAccount || !targetAccount) {
      throw new ValidationError('Sweep rule accounts must exist inside the current organization');
    }
    if (sourceAccount.currency_code !== pool.base_currency || targetAccount.currency_code !== pool.base_currency) {
      throw new ValidationError('Sweep rule accounts must match the pool base currency');
    }

    return withTransactionBoundary('liquidity.rules.create', async () =>
      this.repository.createSweepingRule(this.context.organizationId, input)
    );
  }

  async deactivateRule(ruleId: string) {
    const existing = await this.repository.getSweepingRule(this.context.organizationId, ruleId);
    if (!existing) {
      throw new NotFoundError('Sweeping rule not found');
    }

    if (!existing.is_active) {
      return existing;
    }

    const updated = await withTransactionBoundary('liquidity.rules.deactivate', async () =>
      this.repository.updateSweepingRule(this.context.organizationId, ruleId, { isActive: false })
    );

    if (!updated) {
      throw new ConflictError('Sweeping rule changed during update');
    }

    return updated;
  }

  async getLiquidityPosition(query: LiquidityPositionQuery = {}): Promise<LiquidityPositionResponse> {
    const snapshots = await this.repository.getLiquidityPosition(this.context.organizationId);
    const activeRules = await this.repository.listSweepingRules(this.context.organizationId);
    const activeRuleCountByPoolId = new Map<string, number>();

    for (const rule of activeRules) {
      activeRuleCountByPoolId.set(rule.liquidity_pool_id, (activeRuleCountByPoolId.get(rule.liquidity_pool_id) ?? 0) + 1);
    }

    const accumulators = new Map<string, PositionAccumulator>();
    for (const snapshot of snapshots) {
      const region = mapCountryToRegion(snapshot.account.country_code);
      if (query.poolId && query.poolId !== snapshot.pool.id) {
        continue;
      }
      if (query.region && query.region.toLowerCase() !== region.toLowerCase()) {
        continue;
      }
      if (query.currencyCode && query.currencyCode !== snapshot.pool.base_currency) {
        continue;
      }

      const currentBalance = snapshot.account.current_balance ?? '0.000000';
      const availableBalance = snapshot.account.available_balance ?? '0.000000';
      const existing = accumulators.get(snapshot.pool.id);

      if (!existing) {
        accumulators.set(snapshot.pool.id, {
          position: {
            pool_id: snapshot.pool.id,
            pool_name: snapshot.pool.name,
            pool_type: snapshot.pool.pool_type,
            base_currency: snapshot.pool.base_currency,
            total_balance: currentBalance,
            available_balance: availableBalance,
            trapped_cash: '0.000000',
            operating_cash: '0.000000',
            reserve_cash: '0.000000',
            account_count: 1,
            active_rule_count: activeRuleCountByPoolId.get(snapshot.pool.id) ?? 0,
            last_sweep_at: null,
            regions: [region]
          }
        });
        continue;
      }

      existing.position.total_balance = addAmounts(existing.position.total_balance, currentBalance);
      existing.position.available_balance = addAmounts(existing.position.available_balance, availableBalance);
      existing.position.account_count += 1;
      if (!existing.position.regions.includes(region)) {
        existing.position.regions.push(region);
      }
    }

    const recentSweepRows = await this.repository.listRecentSweepEvents(
      this.context.organizationId,
      activeRules.map((rule) => rule.id)
    );
    const poolIdByRuleId = new Map(activeRules.map((rule) => [rule.id, rule.liquidity_pool_id]));
    const lastSweepByPoolId = new Map<string, string>();

    for (const row of recentSweepRows) {
      if (!row.entity_id) {
        continue;
      }

      const poolId = poolIdByRuleId.get(row.entity_id);
      if (poolId && !lastSweepByPoolId.has(poolId)) {
        lastSweepByPoolId.set(poolId, row.occurred_at);
      }
    }

    const pools = Array.from(accumulators.values()).map(({ position }) => {
      const trappedCash = maxDecimalString(subtractAmounts(position.total_balance, position.available_balance), '0.000000');
      const reserveCash =
        position.pool_type === 'notional'
          ? minDecimalString(position.available_balance, trappedCash)
          : '0.000000';
      const operatingCash = maxDecimalString(subtractAmounts(position.available_balance, reserveCash), '0.000000');

      return {
        ...position,
        trapped_cash: trappedCash,
        reserve_cash: reserveCash,
        operating_cash: operatingCash,
        last_sweep_at: lastSweepByPoolId.get(position.pool_id) ?? null,
        regions: [...position.regions].sort()
      };
    });

    const totalBalance = sumDecimalStrings(pools.map((pool) => pool.total_balance));
    const availableBalance = sumDecimalStrings(pools.map((pool) => pool.available_balance));
    const trappedCash = sumDecimalStrings(pools.map((pool) => pool.trapped_cash));

    return {
      generated_at: new Date().toISOString(),
      total_balance: totalBalance,
      available_balance: availableBalance,
      trapped_cash: trappedCash,
      runway_days: calculateRunwayDays(availableBalance, pools),
      pools: pools.sort((left, right) => left.pool_name.localeCompare(right.pool_name)),
      concentration_analysis: await this.getConcentrationAnalysis(pools)
    };
  }

  async executeSweep(ruleId: string): Promise<SweepExecutionResult> {
    const executionDate = new Date().toISOString().slice(0, 10);
    const alreadyExecuted = await this.repository.hasSweepExecution(this.context.organizationId, ruleId, executionDate);
    const rule = await this.repository.getSweepingRule(this.context.organizationId, ruleId);

    if (!rule) {
      throw new NotFoundError('Sweeping rule not found');
    }
    if (!rule.is_active) {
      throw new ConflictError('Inactive sweep rules cannot be executed');
    }
    if (alreadyExecuted) {
      return {
        rule_id: rule.id,
        pool_id: rule.liquidity_pool_id,
        status: 'skipped',
        reason: 'An idempotent sweep for this rule already executed today',
        transfer_amount: null,
        source_account_id: rule.source_account_id,
        target_account_id: rule.target_account_id,
        executed_at: new Date().toISOString()
      };
    }

    const poolAccounts = await this.repository.getPoolAccounts(this.context.organizationId, rule.liquidity_pool_id);
    const source = poolAccounts.find((account) => account.bank_account_id === rule.source_account_id);
    const target = poolAccounts.find((account) => account.bank_account_id === rule.target_account_id);

    if (!source || !target) {
      throw new ValidationError('Sweep rule references accounts that are no longer assigned to the pool');
    }

    const sourceAvailable = source.available_balance ?? '0.000000';
    const sourceCurrent = source.current_balance ?? '0.000000';
    const targetAvailable = target.available_balance ?? '0.000000';
    const targetCurrent = target.current_balance ?? '0.000000';

    if (compareDecimalStrings(sourceAvailable, rule.min_balance) <= 0) {
      return {
        rule_id: rule.id,
        pool_id: rule.liquidity_pool_id,
        status: 'skipped',
        reason: 'Source account is already at or below the configured minimum balance',
        transfer_amount: null,
        source_account_id: rule.source_account_id,
        target_account_id: rule.target_account_id,
        executed_at: new Date().toISOString()
      };
    }

    const availableHeadroom = maxDecimalString(subtractAmounts(sourceAvailable, rule.min_balance), '0.000000');
    const targetShortfall = maxDecimalString(subtractAmounts(rule.target_balance, targetAvailable), '0.000000');
    const transferAmount = minDecimalString(minDecimalString(availableHeadroom, targetShortfall), rule.max_transfer ?? targetShortfall);

    if (!isPositiveDecimalString(transferAmount)) {
      return {
        rule_id: rule.id,
        pool_id: rule.liquidity_pool_id,
        status: 'skipped',
        reason: 'No transfer is required to reach the target balance within the configured limits',
        transfer_amount: null,
        source_account_id: rule.source_account_id,
        target_account_id: rule.target_account_id,
        executed_at: new Date().toISOString()
      };
    }

    const executedAt = new Date().toISOString();
    const sourceAfter = {
      available_balance: subtractAmounts(sourceAvailable, transferAmount),
      current_balance: subtractAmounts(sourceCurrent, transferAmount)
    };
    const targetAfter = {
      available_balance: addAmounts(targetAvailable, transferAmount),
      current_balance: addAmounts(targetCurrent, transferAmount)
    };

    await withTransactionBoundary('liquidity.sweep.execute', async () =>
      this.repository.persistSweepExecution(this.context.organizationId, {
        poolId: rule.liquidity_pool_id,
        ruleId: rule.id,
        sourceAccountId: rule.source_account_id,
        targetAccountId: rule.target_account_id,
        currencyCode: source.currency_code ?? target.currency_code ?? 'USD',
        transferAmount,
        sourceBefore: {
          available_balance: sourceAvailable,
          current_balance: sourceCurrent
        },
        sourceAfter,
        targetBefore: {
          available_balance: targetAvailable,
          current_balance: targetCurrent
        },
        targetAfter,
        executedAt,
        actorUserId: this.context.userId,
        requestId: this.context.requestId
      })
    );

    return {
      rule_id: rule.id,
      pool_id: rule.liquidity_pool_id,
      status: 'executed',
      transfer_amount: transferAmount,
      source_account_id: rule.source_account_id,
      target_account_id: rule.target_account_id,
      executed_at: executedAt
    };
  }

  async executePoolSweep(poolId: string): Promise<SweepExecutionResult[]> {
    const pool = await this.repository.getPool(this.context.organizationId, poolId);
    if (!pool) {
      throw new NotFoundError('Liquidity pool not found');
    }

    const rules = await this.repository.listSweepingRules(this.context.organizationId, poolId);
    const results: SweepExecutionResult[] = [];
    for (const rule of rules) {
      results.push(await this.executeSweep(rule.id));
    }

    return results;
  }

  async createIntercompanyLoan(input: CreateIntercompanyLoanInput) {
    if (!isPositiveDecimalString(input.amount)) {
      throw new ValidationError('Intercompany loan amount must be positive');
    }
    if (input.lenderEntityId === input.borrowerEntityId) {
      throw new ValidationError('Lender and borrower entities must differ');
    }
    if (input.interestRate && compareDecimalStrings(input.interestRate, '0') < 0) {
      throw new ValidationError('Interest rate cannot be negative');
    }

    const loan = await withTransactionBoundary('liquidity.intercompany.create', async () =>
      this.repository.createIntercompanyLoan(this.context.organizationId, input)
    );

    return {
      ...loan,
      approval_state: 'pending_bilateral_approval'
    };
  }

  async listLoans(status?: IntercompanyTransaction['status']) {
    const loans = await this.repository.listIntercompanyLoans(this.context.organizationId, status);
    const today = new Date().toISOString().slice(0, 10);

    return loans.map((loan) => ({
      ...loan,
      display_status:
        loan.status === 'active' && loan.maturity_date && loan.maturity_date < today ? 'overdue' : loan.status,
      approval_state: loan.status === 'proposed' ? 'pending_bilateral_approval' : 'approved'
    }));
  }

  async settleLoan(loanId: string) {
    const loan = await this.repository.getIntercompanyLoan(this.context.organizationId, loanId);
    if (!loan) {
      throw new NotFoundError('Intercompany loan not found');
    }
    if (loan.status !== 'active') {
      throw new ConflictError('Only active intercompany loans can be settled');
    }

    const settled = await withTransactionBoundary('liquidity.intercompany.settle', async () =>
      this.repository.settleIntercompanyLoan(this.context.organizationId, loanId)
    );

    if (!settled) {
      throw new ConflictError('Intercompany loan changed during settlement');
    }

    return {
      ...settled,
      display_status: settled.status,
      approval_state: 'approved'
    };
  }

  async getConcentrationAnalysis(existingPools?: LiquidityPosition[]): Promise<ConcentrationAnalysis> {
    const pools = existingPools ?? (await this.getLiquidityPosition()).pools;
    const totalBalance = sumDecimalStrings(pools.map((pool) => pool.total_balance));

    return {
      by_region: buildRegionBuckets(pools, totalBalance),
      by_currency: buildCurrencyBuckets(pools, totalBalance),
      by_entity_type: await buildEntityTypeBuckets(this.repository, this.context.organizationId, totalBalance)
    };
  }

  private async validatePoolAccounts(baseCurrency: string, accountIds: string[]) {
    const accounts = await this.repository.getAccountsByIds(this.context.organizationId, accountIds);
    if (accounts.length !== accountIds.length) {
      throw new ValidationError('All pool accounts must exist inside the current organization');
    }

    const invalidCurrencyAccount = accounts.find((account) => account.currency_code !== baseCurrency);
    if (invalidCurrencyAccount) {
      throw new ValidationError('Pool accounts must match the pool base currency', {
        accountId: invalidCurrencyAccount.id,
        accountCurrency: invalidCurrencyAccount.currency_code,
        baseCurrency
      });
    }
  }

  private assertUniqueAccounts(accountIds: string[]) {
    if (new Set(accountIds).size !== accountIds.length) {
      throw new ValidationError('Duplicate bank accounts cannot be assigned to the same liquidity pool');
    }
  }
}

function mapCountryToRegion(countryCode?: string | null) {
  if (!countryCode) {
    return 'Global';
  }

  return REGION_BY_COUNTRY[countryCode] ?? 'Global';
}

function buildRegionBuckets(pools: LiquidityPosition[], totalBalance: string): ConcentrationBucket[] {
  const buckets = new Map<string, LiquidityPosition[]>();

  for (const pool of pools) {
    const region = pool.regions[0] ?? 'Global';
    const existing = buckets.get(region) ?? [];
    existing.push(pool);
    buckets.set(region, existing);
  }

  return Array.from(buckets.entries()).map(([region, regionPools]) => {
    const total = sumDecimalStrings(regionPools.map((pool) => pool.total_balance));
    const available = sumDecimalStrings(regionPools.map((pool) => pool.available_balance));
    const trapped = sumDecimalStrings(regionPools.map((pool) => pool.trapped_cash));
    const operating = sumDecimalStrings(regionPools.map((pool) => pool.operating_cash));
    const reserve = sumDecimalStrings(regionPools.map((pool) => pool.reserve_cash));
    const concentrationPct = toPctString(total, totalBalance);
    const limitPct = '0.450000';

    return {
      key: region.toLowerCase(),
      label: region,
      total_balance: total,
      available_balance: available,
      trapped_cash: trapped,
      operating_cash: operating,
      reserve_cash: reserve,
      concentration_pct: concentrationPct,
      limit_pct: limitPct,
      breached: compareDecimalStrings(concentrationPct, limitPct) > 0
    };
  });
}

function buildCurrencyBuckets(pools: LiquidityPosition[], totalBalance: string): ConcentrationBucket[] {
  const buckets = new Map<string, LiquidityPosition[]>();

  for (const pool of pools) {
    const existing = buckets.get(pool.base_currency) ?? [];
    existing.push(pool);
    buckets.set(pool.base_currency, existing);
  }

  return Array.from(buckets.entries()).map(([currencyCode, currencyPools]) => {
    const total = sumDecimalStrings(currencyPools.map((pool) => pool.total_balance));
    const concentrationPct = toPctString(total, totalBalance);
    const limitPct = currencyCode === 'USD' ? '0.700000' : '0.400000';

    return {
      key: currencyCode,
      label: currencyCode,
      total_balance: total,
      concentration_pct: concentrationPct,
      limit_pct: limitPct,
      breached: compareDecimalStrings(concentrationPct, limitPct) > 0
    };
  });
}

async function buildEntityTypeBuckets(repository: LiquidityRepository, orgId: string, totalBalance: string) {
  const loans = await repository.listIntercompanyLoans(orgId);
  const exposure = sumDecimalStrings(loans.map((loan) => loan.amount));

  return [
    {
      key: 'lender_entity',
      label: 'Lender entities',
      total_balance: exposure,
      concentration_pct: toPctString(exposure, totalBalance)
    },
    {
      key: 'borrower_entity',
      label: 'Borrower entities',
      total_balance: exposure,
      concentration_pct: toPctString(exposure, totalBalance)
    }
  ];
}

function toPctString(value: string, total: string) {
  const totalScaled = decimalToScaledInteger(total);
  if (totalScaled <= 0n) {
    return '0.000000';
  }

  const scaledPct = (decimalToScaledInteger(value) * 1_000_000n) / totalScaled;
  return scaledIntegerToAmount(scaledPct);
}

function calculateRunwayDays(availableBalance: string, pools: LiquidityPosition[]) {
  const totalOperational = sumDecimalStrings(pools.map((pool) => pool.operating_cash));
  const divisor = decimalToScaledInteger(totalOperational);
  if (divisor <= 0n) {
    return null;
  }

  return Number(decimalToScaledInteger(availableBalance) / divisor);
}
