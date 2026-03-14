import { describe, expect, it } from 'vitest';
import { RiskCalculationEngine } from '@/services/risk/calculation-engine';
import { createSupabaseClientMock } from '../utils/supabaseMock';

function createFxServiceStub(rates: Record<string, number>) {
  return {
    async getRate(input: { base: string; quote: string }) {
      const key = `${input.base.toUpperCase()}/${input.quote.toUpperCase()}`;
      const rate = rates[key];
      if (rate === undefined) {
        throw new Error(`Missing FX rate for ${key}`);
      }

      return {
        baseCurrency: input.base.toUpperCase(),
        quoteCurrency: input.quote.toUpperCase(),
        rate,
        timestamp: '2026-03-14T09:00:00.000Z',
        source: 'test'
      };
    }
  };
}

describe('RiskCalculationEngine', () => {
  it('calculates FX exposure with hedging and policy coverage checks in base currency', async () => {
    const { client } = createSupabaseClientMock({
      organizations: {
        data: {
          id: 'org-test-1',
          base_currency: 'USD'
        }
      },
      treasury_policies: {
        data: [
          {
            rules: {
              warningThresholdRatio: '0.800000',
              fx: {
                default: {
                  maxUnhedgedAmount: '100.000000',
                  minCoverageRatio: '0.500000'
                }
              }
            }
          }
        ]
      },
      payments: {
        data: [
          {
            id: 'pay-1',
            amount: '50.000000',
            currency_code: 'EUR',
            status: 'approved',
            beneficiary_counterparty_id: 'cp-1'
          }
        ]
      },
      transactions: {
        data: [
          {
            id: 'txn-1',
            amount: '20.000000',
            currency_code: 'EUR',
            direction: 'inflow',
            category: 'receivable',
            reconciliation_status: 'unreconciled',
            counterparty_id: 'cp-2'
          }
        ]
      },
      hedging_instruments: {
        data: [
          {
            id: 'hedge-1',
            notional_amount: '10.000000',
            base_currency: 'EUR',
            quote_currency: 'USD',
            status: 'active'
          }
        ]
      }
    });
    const engine = new RiskCalculationEngine({
      dbClient: client as never,
      fxService: createFxServiceStub({
        'EUR/USD': 1.2
      }) as never,
      now: () => new Date('2026-03-14T10:00:00.000Z')
    });

    const exposures = await engine.calculateFxExposure('org-test-1');

    expect(exposures).toEqual([
      {
        riskType: 'fx',
        currencyPair: 'EUR/USD',
        foreignCurrency: 'EUR',
        baseCurrency: 'USD',
        valuationDate: '2026-03-14',
        grossExposureAmount: '84.000000',
        netExposureAmount: '36.000000',
        hedgedAmount: '12.000000',
        unhedgedAmount: '24.000000',
        hedgeCoverageRatio: '0.333333',
        limitAmount: '100.000000',
        minimumCoverageRatio: '0.500000',
        warningThresholdRatio: '0.800000',
        status: 'breached',
        fxRate: '1.200000'
      }
    ]);
  });

  it('flags concentration risk when a counterparty exceeds the policy concentration limit', async () => {
    const { client } = createSupabaseClientMock({
      organizations: {
        data: {
          id: 'org-test-1',
          base_currency: 'USD'
        }
      },
      treasury_policies: {
        data: [
          {
            rules: {
              warningThresholdRatio: '0.800000',
              counterparty: {
                maxConcentrationRatio: '0.250000'
              }
            }
          }
        ]
      },
      payments: {
        data: [
          {
            id: 'pay-1',
            amount: '50.000000',
            currency_code: 'USD',
            status: 'approved',
            beneficiary_counterparty_id: 'cp-1'
          },
          {
            id: 'pay-2',
            amount: '200.000000',
            currency_code: 'USD',
            status: 'approved',
            beneficiary_counterparty_id: 'cp-2'
          }
        ]
      },
      transactions: {
        data: []
      },
      debt_facilities: {
        data: []
      },
      counterparties: {
        data: [
          { id: 'cp-1', name: 'North Bank' },
          { id: 'cp-2', name: 'South Bank' }
        ]
      }
    });
    const engine = new RiskCalculationEngine({
      dbClient: client as never,
      fxService: createFxServiceStub({
        'USD/USD': 1
      }) as never,
      now: () => new Date('2026-03-14T10:00:00.000Z')
    });

    const result = await engine.calculateCounterpartyConcentration('org-test-1');

    expect(result).toEqual([
      expect.objectContaining({
        counterpartyId: 'cp-2',
        counterpartyName: 'South Bank',
        exposureAmount: '200.000000',
        concentrationRatio: '0.800000',
        status: 'breached'
      }),
      expect.objectContaining({
        counterpartyId: 'cp-1',
        counterpartyName: 'North Bank',
        exposureAmount: '50.000000',
        concentrationRatio: '0.200000',
        status: 'warning'
      })
    ]);
  });
});
