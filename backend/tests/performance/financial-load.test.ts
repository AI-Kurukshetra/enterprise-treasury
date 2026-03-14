import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { sumDecimalStrings } from '@/utils/money';
import { fixtureUuid } from '../fixtures/treasury';
import { RiskService } from '@/services/risk/service';
import { createServiceContext } from '../utils/context';

describe('performance smoke coverage', () => {
  it('aggregates 10,000 transaction-scale decimals within a bounded runtime', () => {
    const amounts = Array.from({ length: 10_000 }, (_, index) => `${index + 1}.123456`);
    const startedAt = performance.now();
    const total = sumDecimalStrings(amounts);
    const elapsedMs = performance.now() - startedAt;

    expect(total).toBe('50006234.560000');
    expect(elapsedMs).toBeLessThan(250);
  });

  it('summarizes 100,000 FX exposure rows within a stable smoke threshold', async () => {
    const repository = {
      listLatestExposures: async () =>
        Array.from({ length: 100_000 }, (_, index) => ({
          id: fixtureUuid(index + 1),
          organization_id: fixtureUuid(1),
          risk_type: 'fx' as const,
          reference_date: '2026-03-14',
          currency_code: index % 2 === 0 ? 'USD' : 'EUR',
          exposure_amount: '1.000000',
          status: 'normal' as const,
          details: null
        })),
      getLatestReferenceDate: async () => '2026-03-14',
      getLastCalculatedAt: async () => '2026-03-14T09:00:00.000Z',
      queueRecalculation: async () => ({ jobId: 'job-1' }),
      listAlerts: async () => []
    };
    const fxRepository = {
      getOrganizationBaseCurrency: async () => 'USD'
    };
    const service = new RiskService(createServiceContext(), repository as never, undefined, undefined, fxRepository as never);

    const startedAt = performance.now();
    const summary = await service.getFxExposureSummary();
    const elapsedMs = performance.now() - startedAt;

    expect(summary.totalExposure).toBe('100000.000000');
    expect(elapsedMs).toBeLessThan(1_500);
  });
});
