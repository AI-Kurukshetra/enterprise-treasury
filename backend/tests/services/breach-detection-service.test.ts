import { describe, expect, it, vi } from 'vitest';
import { BreachDetectionService } from '@/services/risk/breach-detection-service';

describe('BreachDetectionService', () => {
  it('persists exposure statuses and avoids duplicate alerts for existing warning states', async () => {
    const replaceExposures = vi.fn(async () => undefined);
    const findActiveAlert = vi.fn(async ({ title }: { title: string }) => {
      if (title === 'Counterparty South Bank concentration') {
        return {
          id: 'alert-existing-warning',
          status: 'acknowledged',
          resolution_note: 'Treasury is monitoring the exposure.'
        };
      }

      if (title === 'Liquidity stress buffer') {
        return {
          id: 'alert-existing-normal',
          status: 'open',
          resolution_note: null
        };
      }

      return null;
    });
    const createAlert = vi.fn(async () => ({
      id: 'alert-new-breach',
      title: 'FX EUR/USD exposure',
      message: 'created'
    }));
    const refreshAlert = vi.fn(async () => undefined);
    const updateAlertStatus = vi.fn(async () => ({
      id: 'alert-existing-normal',
      status: 'resolved'
    }));
    const enqueue = vi.fn(async () => 'job-notify-1');

    const calculationEngine = {
      calculateFxExposure: vi.fn(async () => [
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
      ]),
      calculateInterestRateExposure: vi.fn(async () => ({
        riskType: 'interest_rate',
        valuationDate: '2026-03-14',
        baseCurrency: 'USD',
        floatingDebtAmount: '40.000000',
        floatingInvestmentAmount: '40.000000',
        netFloatingRateExposure: '0.000000',
        limitAmount: '200.000000',
        warningThresholdRatio: '0.800000',
        shockScenarios: [],
        status: 'normal'
      })),
      calculateCounterpartyConcentration: vi.fn(async () => [
        {
          riskType: 'credit',
          counterpartyId: 'cp-2',
          counterpartyName: 'South Bank',
          valuationDate: '2026-03-14',
          baseCurrency: 'USD',
          exposureAmount: '200.000000',
          totalExposureAmount: '250.000000',
          concentrationRatio: '0.800000',
          limitRatio: '0.250000',
          warningThresholdRatio: '0.800000',
          status: 'warning'
        }
      ]),
      calculateLiquidityStress: vi.fn(async () => ({
        riskType: 'liquidity',
        valuationDate: '2026-03-14',
        baseCurrency: 'USD',
        currentCashBuffer: '1200.000000',
        baselineMinimumCashBuffer: '1000.000000',
        stressedMinimumCashBuffer: '950.000000',
        minimumPolicyBuffer: '800.000000',
        inflowStressRatio: '0.200000',
        outflowStressRatio: '0.200000',
        forecastWindowDays: 30,
        status: 'normal'
      }))
    };

    const service = new BreachDetectionService({
      calculationEngine: calculationEngine as never,
      queue: { enqueue } as never,
      riskRepositoryFactory: () =>
        ({
          replaceExposures
        }) as never,
      alertsRepositoryFactory: () =>
        ({
          findActiveAlert,
          createAlert,
          refreshAlert,
          updateAlertStatus
        }) as never
    });

    const summary = await service.checkAllBreaches('org-test-1');

    expect(summary.breached).toHaveLength(1);
    expect(summary.warning).toHaveLength(1);
    expect(summary.normal).toHaveLength(2);
    expect(replaceExposures).toHaveBeenCalledTimes(1);
    expect(createAlert).toHaveBeenCalledTimes(1);
    expect(refreshAlert).toHaveBeenCalledTimes(1);
    expect(updateAlertStatus).toHaveBeenCalledWith(
      'alert-existing-normal',
      'resolved',
      undefined,
      'Auto-resolved after liquidity returned within policy.'
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
