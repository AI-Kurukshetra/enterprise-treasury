import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '@/errors/ConflictError';
import { ValidationError } from '@/errors/ValidationError';
import { LiquidityService } from '@/services/liquidity/service';
import { createServiceContext } from '../utils/context';

function createLiquidityService(overrides: Partial<Record<string, unknown>> = {}) {
  const repository = {
    listPools: vi.fn(async () => []),
    getPool: vi.fn(async () => null),
    getPoolAccounts: vi.fn(async () => []),
    getPoolRules: vi.fn(async () => []),
    createPool: vi.fn(async () => ({
      id: 'pool-1',
      organization_id: 'org-test-1',
      name: 'North America pool',
      pool_type: 'physical',
      base_currency: 'USD',
      created_at: '2026-03-14T00:00:00Z',
      updated_at: '2026-03-14T00:00:00Z'
    })),
    updatePool: vi.fn(async () => null),
    listSweepingRules: vi.fn(async () => []),
    getSweepingRule: vi.fn(async () => null),
    createSweepingRule: vi.fn(async () => ({
      id: 'rule-1',
      organization_id: 'org-test-1',
      liquidity_pool_id: 'pool-1',
      rule_name: 'Daily sweep',
      source_account_id: 'acc-source',
      target_account_id: 'acc-target',
      min_balance: '50.000000',
      target_balance: '140.000000',
      max_transfer: '30.000000',
      frequency: 'daily',
      is_active: true,
      created_at: '2026-03-14T00:00:00Z',
      updated_at: '2026-03-14T00:00:00Z'
    })),
    updateSweepingRule: vi.fn(async () => null),
    getLiquidityPosition: vi.fn(async () => []),
    getAccountsByIds: vi.fn(async () => []),
    listRecentSweepEvents: vi.fn(async () => []),
    hasSweepExecution: vi.fn(async () => false),
    persistSweepExecution: vi.fn(async () => undefined),
    createIntercompanyLoan: vi.fn(async () => ({
      id: 'loan-1',
      organization_id: 'org-test-1',
      lender_entity_id: 'entity-a',
      borrower_entity_id: 'entity-b',
      amount: '100.000000',
      currency_code: 'USD',
      interest_rate: '4.500000',
      status: 'proposed',
      maturity_date: '2026-09-30',
      created_at: '2026-03-14T00:00:00Z',
      updated_at: '2026-03-14T00:00:00Z'
    })),
    listIntercompanyLoans: vi.fn(async () => []),
    getIntercompanyLoan: vi.fn(async () => null),
    settleIntercompanyLoan: vi.fn(async () => null),
    ...overrides
  };

  return {
    service: new LiquidityService(createServiceContext(), repository as never),
    repository
  };
}

describe('LiquidityService', () => {
  it('rejects duplicate accounts when creating a pool', async () => {
    const { service } = createLiquidityService();

    await expect(
      service.createPool({
        name: 'Dup pool',
        poolType: 'physical',
        baseCurrency: 'USD',
        accounts: [
          { bankAccountId: 'acc-1', priority: 1 },
          { bankAccountId: 'acc-1', priority: 2 }
        ]
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects sweeping rules that reference accounts outside the selected pool', async () => {
    const { service } = createLiquidityService({
      getPool: vi.fn(async () => ({
        id: 'pool-1',
        organization_id: 'org-test-1',
        name: 'USD Pool',
        pool_type: 'physical',
        base_currency: 'USD',
        created_at: '2026-03-14T00:00:00Z',
        updated_at: '2026-03-14T00:00:00Z'
      })),
      getPoolAccounts: vi.fn(async () => [
        {
          id: 'link-1',
          organization_id: 'org-test-1',
          liquidity_pool_id: 'pool-1',
          bank_account_id: 'acc-source',
          priority: 1,
          created_at: '2026-03-14T00:00:00Z',
          updated_at: '2026-03-14T00:00:00Z'
        }
      ]),
      getAccountsByIds: vi.fn(async () => [
        {
          id: 'acc-source',
          organization_id: 'org-test-1',
          account_name: 'Source',
          account_number_masked: '****1234',
          currency_code: 'USD',
          country_code: 'US',
          status: 'active'
        },
        {
          id: 'acc-target',
          organization_id: 'org-test-1',
          account_name: 'Target',
          account_number_masked: '****5678',
          currency_code: 'USD',
          country_code: 'US',
          status: 'active'
        }
      ])
    });

    await expect(
      service.createRule({
        poolId: 'pool-1',
        ruleName: 'Rule',
        sourceAccountId: 'acc-source',
        targetAccountId: 'acc-target',
        minBalance: '50.000000',
        targetBalance: '100.000000',
        maxTransfer: '25.000000',
        frequency: 'daily'
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('skips sweep execution when the same rule already executed today', async () => {
    const { service, repository } = createLiquidityService({
      hasSweepExecution: vi.fn(async () => true),
      getSweepingRule: vi.fn(async () => ({
        id: 'rule-1',
        organization_id: 'org-test-1',
        liquidity_pool_id: 'pool-1',
        rule_name: 'Daily sweep',
        source_account_id: 'acc-source',
        target_account_id: 'acc-target',
        min_balance: '50.000000',
        target_balance: '140.000000',
        max_transfer: '30.000000',
        frequency: 'daily',
        is_active: true,
        created_at: '2026-03-14T00:00:00Z',
        updated_at: '2026-03-14T00:00:00Z'
      }))
    });

    const result = await service.executeSweep('rule-1');

    expect(result.status).toBe('skipped');
    expect(repository.persistSweepExecution).not.toHaveBeenCalled();
  });

  it('persists deterministic source and target balances when executing a sweep', async () => {
    const { service, repository } = createLiquidityService({
      getSweepingRule: vi.fn(async () => ({
        id: 'rule-1',
        organization_id: 'org-test-1',
        liquidity_pool_id: 'pool-1',
        rule_name: 'Daily sweep',
        source_account_id: 'acc-source',
        target_account_id: 'acc-target',
        min_balance: '50.000000',
        target_balance: '140.000000',
        max_transfer: '30.000000',
        frequency: 'daily',
        is_active: true,
        created_at: '2026-03-14T00:00:00Z',
        updated_at: '2026-03-14T00:00:00Z'
      })),
      getPoolAccounts: vi.fn(async () => [
        {
          id: 'link-1',
          organization_id: 'org-test-1',
          liquidity_pool_id: 'pool-1',
          bank_account_id: 'acc-source',
          priority: 1,
          created_at: '2026-03-14T00:00:00Z',
          updated_at: '2026-03-14T00:00:00Z',
          currency_code: 'USD',
          available_balance: '120.000000',
          current_balance: '120.000000'
        },
        {
          id: 'link-2',
          organization_id: 'org-test-1',
          liquidity_pool_id: 'pool-1',
          bank_account_id: 'acc-target',
          priority: 2,
          created_at: '2026-03-14T00:00:00Z',
          updated_at: '2026-03-14T00:00:00Z',
          currency_code: 'USD',
          available_balance: '100.000000',
          current_balance: '100.000000'
        }
      ])
    });

    const result = await service.executeSweep('rule-1');

    expect(result.status).toBe('executed');
    expect(result.transfer_amount).toBe('30.000000');
    expect(repository.persistSweepExecution).toHaveBeenCalledWith(
      'org-test-1',
      expect.objectContaining({
        transferAmount: '30.000000',
        sourceAfter: {
          available_balance: '90.000000',
          current_balance: '90.000000'
        },
        targetAfter: {
          available_balance: '130.000000',
          current_balance: '130.000000'
        }
      })
    );
  });

  it('aggregates liquidity positions into pooled totals and trapped cash', async () => {
    const { service } = createLiquidityService({
      getLiquidityPosition: vi.fn(async () => [
        {
          pool: {
            id: 'pool-1',
            organization_id: 'org-test-1',
            name: 'North America',
            pool_type: 'physical',
            base_currency: 'USD',
            created_at: '2026-03-14T00:00:00Z',
            updated_at: '2026-03-14T00:00:00Z'
          },
          account: {
            id: 'link-1',
            organization_id: 'org-test-1',
            liquidity_pool_id: 'pool-1',
            bank_account_id: 'acc-1',
            priority: 1,
            created_at: '2026-03-14T00:00:00Z',
            updated_at: '2026-03-14T00:00:00Z',
            country_code: 'US',
            available_balance: '80.000000',
            current_balance: '100.000000'
          }
        },
        {
          pool: {
            id: 'pool-1',
            organization_id: 'org-test-1',
            name: 'North America',
            pool_type: 'physical',
            base_currency: 'USD',
            created_at: '2026-03-14T00:00:00Z',
            updated_at: '2026-03-14T00:00:00Z'
          },
          account: {
            id: 'link-2',
            organization_id: 'org-test-1',
            liquidity_pool_id: 'pool-1',
            bank_account_id: 'acc-2',
            priority: 2,
            created_at: '2026-03-14T00:00:00Z',
            updated_at: '2026-03-14T00:00:00Z',
            country_code: 'US',
            available_balance: '50.000000',
            current_balance: '50.000000'
          }
        }
      ]),
      listSweepingRules: vi.fn(async () => [
        {
          id: 'rule-1',
          organization_id: 'org-test-1',
          liquidity_pool_id: 'pool-1',
          rule_name: 'Daily sweep',
          source_account_id: 'acc-1',
          target_account_id: 'acc-2',
          min_balance: '50.000000',
          target_balance: '140.000000',
          max_transfer: '30.000000',
          frequency: 'daily',
          is_active: true,
          created_at: '2026-03-14T00:00:00Z',
          updated_at: '2026-03-14T00:00:00Z'
        }
      ]),
      listIntercompanyLoans: vi.fn(async () => [])
    });

    const result = await service.getLiquidityPosition();

    expect(result.total_balance).toBe('150.000000');
    expect(result.available_balance).toBe('130.000000');
    expect(result.trapped_cash).toBe('20.000000');
    expect(result.pools[0]?.account_count).toBe(2);
  });

  it('marks new intercompany loans as pending bilateral approval', async () => {
    const { service } = createLiquidityService();

    const result = await service.createIntercompanyLoan({
      lenderEntityId: 'entity-a',
      borrowerEntityId: 'entity-b',
      amount: '100.000000',
      currencyCode: 'USD',
      interestRate: '4.500000',
      maturityDate: '2026-09-30'
    });

    expect(result.approval_state).toBe('pending_bilateral_approval');
    expect(result.status).toBe('proposed');
  });

  it('prevents proposed loans from being settled', async () => {
    const { service } = createLiquidityService({
      getIntercompanyLoan: vi.fn(async () => ({
        id: 'loan-1',
        organization_id: 'org-test-1',
        lender_entity_id: 'entity-a',
        borrower_entity_id: 'entity-b',
        amount: '100.000000',
        currency_code: 'USD',
        interest_rate: '4.500000',
        status: 'proposed',
        maturity_date: '2026-09-30',
        created_at: '2026-03-14T00:00:00Z',
        updated_at: '2026-03-14T00:00:00Z'
      }))
    });

    await expect(service.settleLoan('loan-1')).rejects.toBeInstanceOf(ConflictError);
  });
});
