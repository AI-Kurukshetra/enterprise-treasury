import { describe, expect, it, vi } from 'vitest';
import { PolicyEvaluator, type EvaluationData, type LoadedPolicy } from '@/lib/policy-engine/policy-evaluator';
import type { PolicyContext } from '@/lib/policy-engine/policy-types';
import { createServiceContext } from '../../utils/context';

function createBaseData(overrides: Partial<EvaluationData> = {}): EvaluationData {
  return {
    leafTypes: new Set(),
    policies: [],
    organization: { id: 'org-test-1', base_currency: 'USD' },
    counterpartiesById: new Map(),
    openPayments: [],
    outstandingTransactions: [],
    debtFacilitiesForExposure: [],
    fxExposures: [],
    cashPositions: [],
    debtFacilitiesById: new Map(),
    ...overrides
  };
}

function createEvaluator(options?: {
  data?: EvaluationData;
  policies?: LoadedPolicy[];
  rates?: Record<string, string>;
  insertAuditEntries?: ReturnType<typeof vi.fn>;
}) {
  const fxService = {
    getRate: vi.fn(async ({ base, quote }: { base: string; quote: string }) => ({
      baseCurrency: base,
      quoteCurrency: quote,
      rate: Number(options?.rates?.[`${base}:${quote}`] ?? '1.000000'),
      timestamp: '2026-03-14T00:00:00.000Z',
      source: 'test'
    }))
  };
  const insertAuditEntries = options?.insertAuditEntries ?? vi.fn(async () => undefined);

  return {
    fxService,
    insertAuditEntries,
    evaluator: new PolicyEvaluator(createServiceContext(), {
      fxService: fxService as never,
      loadPolicies: async () => options?.policies ?? [],
      prepareEvaluationData: async (_orgId, _context, policies) =>
        createBaseData({
          ...(options?.data ?? {}),
          policies
        }),
      insertAuditEntries
    })
  };
}

describe('PolicyEvaluator', () => {
  it('evaluates amount thresholds with FX conversion', async () => {
    const { evaluator } = createEvaluator({
      rates: {
        'EUR:USD': '1.100000'
      }
    });

    await expect(
      evaluator.evaluateCondition(
        {
          type: 'amount_exceeds',
          threshold: '1000.000000',
          currency: 'USD'
        },
        {
          domain: 'payment',
          payment: {
            amount: '950.000000',
            currency: 'EUR',
            counterpartyId: 'cp-1',
            sourceAccountId: 'acc-1'
          }
        }
      )
    ).resolves.toBe(true);
  });

  it('evaluates counterparty concentration with current payment included', async () => {
    const { evaluator } = createEvaluator({
      data: createBaseData({
        openPayments: [
          {
            id: 'pay-1',
            amount: '300.000000',
            currency_code: 'USD',
            beneficiary_counterparty_id: 'cp-1'
          },
          {
            id: 'pay-2',
            amount: '700.000000',
            currency_code: 'USD',
            beneficiary_counterparty_id: 'cp-2'
          }
        ]
      })
    });

    await expect(
      evaluator.evaluateCondition(
        {
          type: 'counterparty_concentration',
          maxPercentage: 40
        },
        {
          domain: 'payment',
          payment: {
            amount: '400.000000',
            currency: 'USD',
            counterpartyId: 'cp-1',
            sourceAccountId: 'acc-1'
          }
        }
      )
    ).resolves.toBe(true);
  });

  it('evaluates restricted-country payment rules', async () => {
    const { evaluator } = createEvaluator({
      data: createBaseData({
        counterpartiesById: new Map([
          [
            'cp-1',
            {
              id: 'cp-1',
              name: 'Vendor',
              country_code: 'IR'
            }
          ]
        ])
      })
    });

    await expect(
      evaluator.evaluateCondition(
        {
          type: 'payment_to_restricted_country',
          countries: ['IR', 'KP']
        },
        {
          domain: 'payment',
          payment: {
            amount: '100.000000',
            currency: 'USD',
            counterpartyId: 'cp-1',
            sourceAccountId: 'acc-1'
          }
        }
      )
    ).resolves.toBe(true);
  });

  it('evaluates FX exposure percentage thresholds', async () => {
    const { evaluator } = createEvaluator({
      data: createBaseData({
        fxExposures: [
          {
            id: 'fx-1',
            currency_code: 'EUR',
            exposure_amount: '300.000000'
          },
          {
            id: 'fx-2',
            currency_code: 'GBP',
            exposure_amount: '700.000000'
          }
        ]
      })
    });

    await expect(
      evaluator.evaluateCondition(
        {
          type: 'fx_exposure_exceeds',
          percentage: 25,
          currency: 'EUR'
        },
        {
          domain: 'forex',
          forex: {
            notional: '200.000000',
            currencyPair: 'EUR/USD',
            instrumentType: 'forward'
          }
        }
      )
    ).resolves.toBe(true);
  });

  it('evaluates account minimum balances after pending payment drawdown', async () => {
    const { evaluator } = createEvaluator({
      data: createBaseData({
        cashPositions: [
          {
            scope_type: 'account',
            scope_id: 'acc-1',
            currency_code: 'USD',
            available_balance: '900.000000'
          }
        ]
      })
    });

    await expect(
      evaluator.evaluateCondition(
        {
          type: 'balance_below_minimum',
          threshold: '500.000000',
          accountId: 'acc-1'
        },
        {
          domain: 'payment',
          payment: {
            amount: '450.000000',
            currency: 'USD',
            counterpartyId: 'cp-1',
            sourceAccountId: 'acc-1'
          }
        }
      )
    ).resolves.toBe(true);
  });

  it('evaluates covenant ratio breaches from facility summaries', async () => {
    const { evaluator } = createEvaluator({
      data: createBaseData({
        debtFacilitiesById: new Map([
          [
            'facility-1',
            {
              id: 'facility-1',
              facility_name: 'RCF',
              currency_code: 'USD',
              covenant_summary: {
                ratios: {
                  leverage: {
                    actual: '4.200000',
                    max: '4.000000'
                  }
                }
              }
            }
          ]
        ])
      })
    });

    await expect(
      evaluator.evaluateCondition(
        {
          type: 'covenant_ratio_breached',
          facilityId: 'facility-1',
          ratio: 'leverage'
        },
        {
          domain: 'liquidity'
        }
      )
    ).resolves.toBe(true);
  });

  it('handles nested and/or condition trees', async () => {
    const { evaluator } = createEvaluator({
      data: createBaseData({
        counterpartiesById: new Map([
          [
            'cp-1',
            {
              id: 'cp-1',
              name: 'Vendor',
              country_code: 'US'
            }
          ]
        ]),
        cashPositions: [
          {
            scope_type: 'account',
            scope_id: 'acc-1',
            currency_code: 'USD',
            available_balance: '1000.000000'
          }
        ]
      })
    });

    await expect(
      evaluator.evaluateCondition(
        {
          type: 'and',
          conditions: [
            {
              type: 'amount_exceeds',
              threshold: '900.000000',
              currency: 'USD'
            },
            {
              type: 'or',
              conditions: [
                {
                  type: 'payment_to_restricted_country',
                  countries: ['KP']
                },
                {
                  type: 'balance_below_minimum',
                  threshold: '50.000000',
                  accountId: 'acc-1'
                }
              ]
            }
          ]
        },
        {
          domain: 'payment',
          payment: {
            amount: '975.000000',
            currency: 'USD',
            counterpartyId: 'cp-1',
            sourceAccountId: 'acc-1'
          }
        }
      )
    ).resolves.toBe(true);
  });

  it('returns combined block and warning results and records audit entries', async () => {
    const insertAuditEntries = vi.fn(async () => undefined);
    const policies: LoadedPolicy[] = [
      {
        id: 'policy-block',
        name: 'High value block',
        domain: 'payment',
        rules: [
          {
            id: 'rule-block',
            name: 'Block large payments',
            action: 'block',
            message: 'Threshold exceeded',
            condition: {
              type: 'amount_exceeds',
              threshold: '500.000000',
              currency: 'USD'
            }
          }
        ]
      },
      {
        id: 'policy-warn',
        name: 'Escalate payroll',
        domain: 'payment',
        rules: [
          {
            id: 'rule-warn',
            name: 'Escalate',
            action: 'require_approval',
            message: 'Treasurer approval required',
            condition: {
              type: 'payment_to_restricted_country',
              countries: ['US']
            }
          }
        ]
      }
    ];
    const { evaluator } = createEvaluator({
      policies,
      insertAuditEntries,
      data: createBaseData({
        counterpartiesById: new Map([
          [
            'cp-1',
            {
              id: 'cp-1',
              name: 'Payroll Vendor',
              country_code: 'US'
            }
          ]
        ])
      })
    });
    const context: PolicyContext = {
      domain: 'payment',
      payment: {
        amount: '800.000000',
        currency: 'USD',
        counterpartyId: 'cp-1',
        sourceAccountId: 'acc-1'
      }
    };

    const result = await evaluator.evaluate('org-test-1', context);

    expect(result.allowed).toBe(false);
    expect(result.action).toBe('block');
    expect(result.violations).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(insertAuditEntries).toHaveBeenCalledOnce();
  });
});
