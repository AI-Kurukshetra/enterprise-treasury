import { describe, expect, it, vi } from 'vitest';
import { CashPositionsService } from '@/services/cash_positions/service';
import { createServiceContext } from '../utils/context';

describe('CashPositionsService', () => {
  it('delegates summary lookups to the aggregation service', async () => {
    const aggregationService = {
      getConsolidatedPosition: vi.fn(async () => ({
        totalCash: '100.000000',
        availableLiquidity: '80.000000',
        pendingPayments: { amount: '20.000000', count: 1 },
        riskLimitsInWatch: 0,
        baseCurrency: 'USD',
        asOf: '2026-03-14T00:00:00Z',
        byCurrency: [],
        byRegion: [],
        trend: [],
        paymentVolume: []
      })),
      getCashTrend: vi.fn(),
      getRegionalBreakdown: vi.fn(),
      recalculate: vi.fn()
    };
    const service = new CashPositionsService(createServiceContext(), aggregationService as never);

    const result = await service.getLatest();

    expect(result.totalCash).toBe('100.000000');
    expect(aggregationService.getConsolidatedPosition).toHaveBeenCalledWith('org-test-1');
  });

  it('delegates trend lookups to the aggregation service with the requested day window', async () => {
    const aggregationService = {
      getConsolidatedPosition: vi.fn(),
      getCashTrend: vi.fn(async () => []),
      getRegionalBreakdown: vi.fn(),
      recalculate: vi.fn()
    };
    const service = new CashPositionsService(createServiceContext(), aggregationService as never);

    await service.getHistory({ days: 30, granularity: 'daily' });

    expect(aggregationService.getCashTrend).toHaveBeenCalledWith('org-test-1', 30);
  });
});
