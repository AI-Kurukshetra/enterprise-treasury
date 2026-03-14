import { describe, expect, it, vi } from 'vitest';
import { RiskService } from '@/services/risk/service';
import { createServiceContext } from '../utils/context';

describe('RiskService', () => {
  it('builds a persisted exposure snapshot and aggregates FX unhedged totals', async () => {
    const repository = {
      getLatestReferenceDate: vi.fn(async () => '2026-03-14'),
      getLastCalculatedAt: vi.fn(async () => '2026-03-14T09:15:00.000Z'),
      listLatestExposures: vi.fn(async () => [
        {
          id: 'risk-1',
          organization_id: 'org-test-1',
          risk_type: 'fx',
          reference_date: '2026-03-14',
          currency_code: 'EUR',
          exposure_amount: '24.000000',
          status: 'warning',
          details: {
            title: 'FX EUR/USD exposure',
            currencyPair: 'EUR/USD',
            currencyCode: 'EUR',
            grossExposureAmount: '84.000000',
            netExposureAmount: '36.000000',
            hedgedAmount: '12.000000',
            unhedgedAmount: '24.000000',
            coverageRatio: '0.333333',
            limitAmount: '100.000000',
            minimumCoverageRatio: '0.500000',
            warningThresholdRatio: '0.800000',
            valuationDate: '2026-03-14',
            fxRate: '1.200000'
          }
        },
        {
          id: 'risk-2',
          organization_id: 'org-test-1',
          risk_type: 'liquidity',
          reference_date: '2026-03-14',
          currency_code: 'USD',
          exposure_amount: '950.000000',
          status: 'normal',
          details: {
            title: 'Liquidity stress buffer',
            currencyCode: 'USD',
            currentCashBuffer: '1200.000000',
            baselineMinimumCashBuffer: '1000.000000',
            coverageRatio: '1.187500',
            limitAmount: '800.000000',
            inflowStressRatio: '0.200000',
            outflowStressRatio: '0.200000',
            forecastWindowDays: 30,
            valuationDate: '2026-03-14'
          }
        }
      ]),
      queueRecalculation: vi.fn()
    };
    const alertsRepository = {
      listAlerts: vi.fn(),
      updateAlertStatus: vi.fn()
    };
    const breachDetectionService = {
      resolveAlert: vi.fn()
    };
    const fxRepository = {
      getOrganizationBaseCurrency: vi.fn(async () => 'USD')
    };

    const service = new RiskService(
      createServiceContext(),
      repository as never,
      alertsRepository as never,
      breachDetectionService as never,
      fxRepository as never
    );

    const snapshot = await service.listExposures();
    const fxSummary = await service.getFxExposureSummary();

    expect(snapshot.baseCurrency).toBe('USD');
    expect(snapshot.summary.warning).toBe(1);
    expect(snapshot.summary.normal).toBe(1);
    expect(snapshot.matrix).toHaveLength(2);
    expect(snapshot.fx[0]?.currencyPair).toBe('EUR/USD');
    expect(snapshot.liquidity?.stressedMinimumCashBuffer).toBe('950.000000');
    expect(fxSummary.totalExposure).toBe('24.000000');
    expect(fxSummary.currencyBreakdown).toEqual([
      {
        currencyCode: 'EUR',
        exposureAmount: '24.000000',
        status: 'warning'
      }
    ]);
  });
});
