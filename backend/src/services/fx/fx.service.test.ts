import { describe, expect, it, vi } from 'vitest';
import { EuropeanCentralBankProvider } from '@/lib/fx-providers/ecb-provider';
import { FxService } from '@/services/fx/service';
import type { FxRate, HedgingInstrument } from '@/types/fx/types';
import { createServiceContext } from '../../../tests/utils/context';

const sampleEcbXml = `<?xml version="1.0" encoding="UTF-8"?>
<message:GenericData xmlns:message="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message" xmlns:generic="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic">
  <generic:DataSet>
    <generic:Series>
      <generic:SeriesKey>
        <generic:Value id="CURRENCY" value="USD"/>
      </generic:SeriesKey>
      <generic:Obs>
        <generic:ObsDimension value="2026-03-13"/>
        <generic:ObsValue value="1.1000"/>
      </generic:Obs>
    </generic:Series>
    <generic:Series>
      <generic:SeriesKey>
        <generic:Value id="CURRENCY" value="GBP"/>
      </generic:SeriesKey>
      <generic:Obs>
        <generic:ObsDimension value="2026-03-13"/>
        <generic:ObsValue value="0.8500"/>
      </generic:Obs>
    </generic:Series>
    <generic:Series>
      <generic:SeriesKey>
        <generic:Value id="CURRENCY" value="JPY"/>
      </generic:SeriesKey>
      <generic:Obs>
        <generic:ObsDimension value="2026-03-13"/>
        <generic:ObsValue value="160.0000"/>
      </generic:Obs>
    </generic:Series>
  </generic:DataSet>
</message:GenericData>`;

function createRepositoryMock(overrides: Partial<{
  getLatestRate: ReturnType<typeof vi.fn>;
  listLatestRates: ReturnType<typeof vi.fn>;
  upsertRates: ReturnType<typeof vi.fn>;
  getOrganizationBaseCurrency: ReturnType<typeof vi.fn>;
  listFxExposures: ReturnType<typeof vi.fn>;
  getExposureById: ReturnType<typeof vi.fn>;
  listActiveHedges: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    getLatestRate: overrides.getLatestRate ?? vi.fn(async () => null),
    listLatestRates: overrides.listLatestRates ?? vi.fn(async () => []),
    upsertRates: overrides.upsertRates ?? vi.fn(async () => undefined),
    getOrganizationBaseCurrency: overrides.getOrganizationBaseCurrency ?? vi.fn(async () => 'USD'),
    listFxExposures: overrides.listFxExposures ?? vi.fn(async () => []),
    getExposureById: overrides.getExposureById ?? vi.fn(async () => null),
    listActiveHedges: overrides.listActiveHedges ?? vi.fn(async () => [])
  };
}

function createProviderMock(ratesByBase: Record<string, Record<string, FxRate>>) {
  return {
    getRate: vi.fn(async (base: string, quote: string) => {
      const baseRates = ratesByBase[base];
      if (!baseRates?.[quote]) {
        throw new Error(`Missing mocked FX rate for ${base}/${quote}`);
      }

      return baseRates[quote];
    }),
    getRates: vi.fn(async (base: string) => {
      const baseRates = ratesByBase[base];
      if (!baseRates) {
        throw new Error(`Missing mocked FX rate set for ${base}`);
      }

      return baseRates;
    }),
    getSupportedCurrencies: vi.fn(async () => Object.keys(ratesByBase.USD ?? {}))
  };
}

describe('EuropeanCentralBankProvider', () => {
  it('parses XML, calculates cross-rates, and reuses the in-memory cache within TTL', async () => {
    const fetchImpl = vi.fn(async () => new Response(sampleEcbXml, { status: 200 }));
    const provider = new EuropeanCentralBankProvider(fetchImpl as typeof fetch);

    const gbpToJpy = await provider.getRate('GBP', 'JPY');
    const usdToEur = await provider.getRate('USD', 'EUR');

    expect(gbpToJpy.rate).toBe(188.23529455);
    expect(usdToEur.rate).toBe(0.90909091);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('FxService', () => {
  it('returns a fresh cached rate without calling the external provider', async () => {
    const repository = createRepositoryMock({
      getLatestRate: vi.fn(async () => ({
        base_currency: 'EUR',
        quote_currency: 'USD',
        rate: '1.10000000',
        provider: 'ecb',
        as_of_at: '2026-03-14T08:00:00.000Z'
      }))
    });
    const provider = createProviderMock({});
    const service = new FxService(createServiceContext(), {
      repository: repository as never,
      provider: provider as never,
      now: () => new Date('2026-03-14T10:00:00.000Z')
    });

    const rate = await service.getRate({ base: 'EUR', quote: 'USD' });

    expect(rate.rate).toBe(1.1);
    expect(rate.source).toBe('ecb');
    expect(provider.getRates).not.toHaveBeenCalled();
  });

  it('refreshes stale rates from the provider and persists them to the database cache', async () => {
    const repository = createRepositoryMock({
      getLatestRate: vi.fn(async () => ({
        base_currency: 'EUR',
        quote_currency: 'USD',
        rate: '1.05000000',
        provider: 'ecb',
        as_of_at: '2026-03-14T00:00:00.000Z'
      }))
    });
    const provider = createProviderMock({
      EUR: {
        EUR: {
          baseCurrency: 'EUR',
          quoteCurrency: 'EUR',
          rate: 1,
          timestamp: '2026-03-14T09:30:00.000Z',
          source: 'ecb'
        },
        USD: {
          baseCurrency: 'EUR',
          quoteCurrency: 'USD',
          rate: 1.12345678,
          timestamp: '2026-03-14T09:30:00.000Z',
          source: 'ecb'
        }
      }
    });
    const service = new FxService(createServiceContext(), {
      repository: repository as never,
      provider: provider as never,
      now: () => new Date('2026-03-14T10:00:00.000Z')
    });

    const rate = await service.getRate({ base: 'EUR', quote: 'USD' });

    expect(rate.rate).toBe(1.12345678);
    expect(provider.getRates).toHaveBeenCalledWith('EUR');
    expect(repository.upsertRates).toHaveBeenCalledWith([
      {
        base_currency: 'EUR',
        quote_currency: 'EUR',
        rate: '1.00000000',
        provider: 'ecb',
        as_of_at: '2026-03-14T09:30:00.000Z'
      },
      {
        base_currency: 'EUR',
        quote_currency: 'USD',
        rate: '1.12345678',
        provider: 'ecb',
        as_of_at: '2026-03-14T09:30:00.000Z'
      }
    ]);
  });

  it('converts amounts with fixed six-decimal precision', async () => {
    const repository = createRepositoryMock({
      getLatestRate: vi.fn(async () => ({
        base_currency: 'EUR',
        quote_currency: 'USD',
        rate: '1.12345678',
        provider: 'ecb',
        as_of_at: '2026-03-14T09:30:00.000Z'
      }))
    });
    const service = new FxService(createServiceContext(), {
      repository: repository as never,
      provider: createProviderMock({}) as never,
      now: () => new Date('2026-03-14T10:00:00.000Z')
    });

    await expect(service.convertAmount('100.000000', 'USD', 'USD')).resolves.toBe('100.000000');
    await expect(service.convertAmount('100.000000', 'EUR', 'USD')).resolves.toBe('112.345678');
  });

  it('aggregates exposure in the organization base currency and calculates hedge coverage', async () => {
    const activeHedges: HedgingInstrument[] = [
      {
        id: 'hedge-1',
        organization_id: 'org-test-1',
        instrument_type: 'forward',
        notional_amount: '10.000000',
        base_currency: 'EUR',
        quote_currency: 'USD',
        trade_date: '2026-03-14',
        maturity_date: '2026-04-30',
        status: 'active'
      }
    ];
    const repository = createRepositoryMock({
      listFxExposures: vi.fn(async () => [
        {
          id: 'fx-exp-1',
          organization_id: 'org-test-1',
          risk_type: 'fx',
          reference_date: '2026-03-14',
          currency_code: 'USD',
          exposure_amount: '40.000000',
          status: 'normal',
          details: {}
        },
        {
          id: 'fx-exp-2',
          organization_id: 'org-test-1',
          risk_type: 'fx',
          reference_date: '2026-03-14',
          currency_code: 'EUR',
          exposure_amount: '50.000000',
          status: 'warning',
          details: {}
        }
      ]),
      listActiveHedges: vi.fn(async () => activeHedges)
    });
    const provider = createProviderMock({
      EUR: {
        EUR: {
          baseCurrency: 'EUR',
          quoteCurrency: 'EUR',
          rate: 1,
          timestamp: '2026-03-14T09:30:00.000Z',
          source: 'ecb'
        },
        USD: {
          baseCurrency: 'EUR',
          quoteCurrency: 'USD',
          rate: 1.2,
          timestamp: '2026-03-14T09:30:00.000Z',
          source: 'ecb'
        }
      }
    });
    const service = new FxService(createServiceContext(), {
      repository: repository as never,
      provider: provider as never,
      now: () => new Date('2026-03-14T10:00:00.000Z')
    });

    const summary = await service.getExposureSummary();

    expect(summary.baseCurrency).toBe('USD');
    expect(summary.totalExposure).toBe('100.000000');
    expect(summary.totalHedgedAmount).toBe('12.000000');
    expect(summary.hedgeCoveragePercent).toBe('12.00');
    expect(summary.uncoveredAmount).toBe('88.000000');
    expect(summary.currencyBreakdown).toEqual([
      {
        currencyCode: 'EUR',
        exposureAmount: '50.000000',
        exposureAmountInBaseCurrency: '60.000000',
        hedgedAmountInBaseCurrency: '12.000000',
        uncoveredAmountInBaseCurrency: '48.000000',
        status: 'warning'
      },
      {
        currencyCode: 'USD',
        exposureAmount: '40.000000',
        exposureAmountInBaseCurrency: '40.000000',
        hedgedAmountInBaseCurrency: '0.000000',
        uncoveredAmountInBaseCurrency: '40.000000',
        status: 'normal'
      }
    ]);
  });

  it('recommends hedge notionals based on target minus current coverage and tenor', async () => {
    const activeHedges: HedgingInstrument[] = [
      {
        id: 'hedge-1',
        organization_id: 'org-test-1',
        instrument_type: 'forward',
        notional_amount: '20.000000',
        base_currency: 'EUR',
        quote_currency: 'USD',
        trade_date: '2026-03-14',
        maturity_date: '2026-04-30',
        status: 'active'
      }
    ];
    const repository = createRepositoryMock({
      getExposureById: vi.fn(async () => ({
        id: 'fx-exp-1',
        organization_id: 'org-test-1',
        risk_type: 'fx',
        reference_date: '2026-03-14',
        currency_code: 'EUR',
        exposure_amount: '100.000000',
        status: 'warning',
        details: {
          targetHedgeRatio: 0.8,
          maturityDate: '2026-07-15'
        }
      })),
      listActiveHedges: vi.fn(async () => activeHedges)
    });
    const service = new FxService(createServiceContext(), {
      repository: repository as never,
      provider: createProviderMock({}) as never,
      now: () => new Date('2026-03-14T10:00:00.000Z')
    });

    const recommendations = await service.recommendHedges('fx-exp-1');

    expect(recommendations).toEqual([
      {
        exposureId: 'fx-exp-1',
        instrumentType: 'swap',
        baseCurrency: 'EUR',
        quoteCurrency: 'USD',
        recommendedNotional: '60.000000',
        currentCoveragePercent: '20.00',
        targetCoveragePercent: '80.00',
        projectedCoveragePercent: '80.00',
        maturityDate: '2026-07-15',
        rationale: 'Raise hedge coverage from 20.00% to 80.00% with a swap maturing on 2026-07-15; tenor is 123 days.'
      }
    ]);
  });
});
