import type { SupabaseClient } from '@supabase/supabase-js';
import { NotFoundError } from '@/errors/NotFoundError';
import { ValidationError } from '@/errors/ValidationError';
import { createFxProvider } from '@/lib/fx-providers/fx-provider-factory';
import type { FxProviderInterface } from '@/lib/fx-providers/fx-provider.interface';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { FxRepository } from '@/repositories/fx/repository';
import type { ServiceContext } from '@/services/context';
import type {
  CurrencyRateRow,
  FxExposureSummary,
  FxRate,
  HedgeRecommendation,
  HedgingInstrument
} from '@/types/fx/types';
import { addAmounts, convertWithRate, divideDecimalStrings, multiplyDecimalStrings, subtractAmounts } from '@/utils/money';

const RATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TARGET_HEDGE_RATIO = '0.800000';

function isServiceContext(value: unknown): value is ServiceContext {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return 'organizationId' in value && 'userId' in value && 'requestId' in value;
}

function asIsoDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.includes('T') ? value : `${value}T23:59:59.999Z`;
}

function isFreshRate(asOfAt: string, now: Date): boolean {
  return now.getTime() - new Date(asOfAt).getTime() <= RATE_CACHE_TTL_MS;
}

function toRateRow(rate: FxRate): CurrencyRateRow {
  return {
    base_currency: rate.baseCurrency,
    quote_currency: rate.quoteCurrency,
    rate: rate.rate.toFixed(8),
    provider: rate.source,
    as_of_at: rate.timestamp
  };
}

function formatPercent(value: string): string {
  return (Number(value) * 100).toFixed(2);
}

function normalizeHedgeNotional(hedge: HedgingInstrument, exposureCurrency: string, baseCurrency: string): string {
  if (hedge.base_currency === exposureCurrency && hedge.quote_currency === baseCurrency) {
    return hedge.notional_amount;
  }

  if (hedge.base_currency === exposureCurrency && hedge.quote_currency === null) {
    return hedge.notional_amount;
  }

  return '0.000000';
}

export class FxService {
  private readonly repository: FxRepository;
  private readonly provider: FxProviderInterface;
  private readonly now: () => Date;
  private readonly organizationId: string | null;

  constructor(
    contextOrDb?: ServiceContext | SupabaseClient,
    options?: {
      repository?: FxRepository;
      provider?: FxProviderInterface;
      now?: () => Date;
    }
  ) {
    const dbClient = isServiceContext(contextOrDb)
      ? createServiceSupabaseClient()
      : contextOrDb ?? createServiceSupabaseClient();
    const organizationId = isServiceContext(contextOrDb) ? contextOrDb.organizationId : null;

    this.organizationId = organizationId;
    this.repository = options?.repository ?? new FxRepository({ organizationId: organizationId ?? '00000000-0000-0000-0000-000000000000' }, dbClient);
    this.provider = options?.provider ?? createFxProvider();
    this.now = options?.now ?? (() => new Date());
  }

  async getRate(input: { base: string; quote: string; asOf?: string }): Promise<FxRate> {
    const base = input.base.toUpperCase();
    const quote = input.quote.toUpperCase();

    if (base === quote) {
      const timestamp = input.asOf ? asIsoDate(input.asOf)! : this.now().toISOString();
      return {
        baseCurrency: base,
        quoteCurrency: quote,
        rate: 1,
        timestamp,
        source: 'parity'
      };
    }

    const cached = await this.repository.getLatestRate(base, quote, input.asOf);
    const now = this.now();

    // For as-of conversions (reporting/snapshots), deterministic historical rates take precedence.
    if (cached && input.asOf) {
      return {
        baseCurrency: cached.base_currency,
        quoteCurrency: cached.quote_currency,
        rate: Number(cached.rate),
        timestamp: cached.as_of_at,
        source: cached.provider
      };
    }

    if (cached && isFreshRate(cached.as_of_at, now)) {
      return {
        baseCurrency: cached.base_currency,
        quoteCurrency: cached.quote_currency,
        rate: Number(cached.rate),
        timestamp: cached.as_of_at,
        source: cached.provider
      };
    }

    try {
      const providerRates = await this.provider.getRates(base);
      const rows = Object.values(providerRates).map(toRateRow);
      await this.repository.upsertRates(rows);

      const selected = providerRates[quote];
      if (!selected) {
        throw new ValidationError(`Unsupported quote currency ${quote}`);
      }

      return selected;
    } catch (error) {
      if (cached) {
        return {
          baseCurrency: cached.base_currency,
          quoteCurrency: cached.quote_currency,
          rate: Number(cached.rate),
          timestamp: cached.as_of_at,
          source: cached.provider
        };
      }

      throw error;
    }
  }

  async getRates(base: string): Promise<Record<string, FxRate>> {
    const normalizedBase = base.toUpperCase();
    const cached = await this.repository.listLatestRates(normalizedBase);
    const freshRates = cached.filter((row) => isFreshRate(row.as_of_at, this.now()));

    if (freshRates.length > 0) {
      return Object.fromEntries(
        freshRates.map((row) => [
          row.quote_currency,
          {
            baseCurrency: row.base_currency,
            quoteCurrency: row.quote_currency,
            rate: Number(row.rate),
            timestamp: row.as_of_at,
            source: row.provider
          }
        ])
      );
    }

    const providerRates = await this.provider.getRates(normalizedBase);
    await this.repository.upsertRates(Object.values(providerRates).map(toRateRow));
    return providerRates;
  }

  async convertAmount(
    input:
      | string
      | {
          organizationId?: string;
          amount: string;
          fromCurrency: string;
          toCurrency: string;
          asOf?: string;
        },
    fromCurrency?: string,
    toCurrency?: string,
    asOf?: string
  ): Promise<string | { amount: string; rate: string; source: string; timestamp: string }> {
    const normalizedInput =
      typeof input === 'string'
        ? {
            amount: input,
            fromCurrency: fromCurrency ?? '',
            toCurrency: toCurrency ?? '',
            asOf
          }
        : input;

    if (!normalizedInput.fromCurrency || !normalizedInput.toCurrency) {
      throw new ValidationError('Both fromCurrency and toCurrency are required');
    }

    if (normalizedInput.fromCurrency.toUpperCase() === normalizedInput.toCurrency.toUpperCase()) {
      const response = {
        amount: normalizedInput.amount,
        rate: '1.000000',
        source: 'parity',
        timestamp: normalizedInput.asOf ?? this.now().toISOString()
      };
      return typeof input === 'string' ? response.amount : response;
    }

    const rate = await this.getRate({
      base: normalizedInput.fromCurrency,
      quote: normalizedInput.toCurrency,
      asOf: normalizedInput.asOf
    });
    const preciseRate = rate.rate.toFixed(8);
    const convertedAmount = convertWithRate(normalizedInput.amount, rate.rate);
    const response = {
      amount: convertedAmount,
      rate: preciseRate,
      source: rate.source,
      timestamp: rate.timestamp
    };

    return typeof input === 'string' ? response.amount : response;
  }

  async getExposureSummary(): Promise<FxExposureSummary> {
    const organizationId = this.requireOrganizationId();
    const baseCurrency = await this.repository.getOrganizationBaseCurrency(organizationId);
    if (!baseCurrency) {
      throw new NotFoundError('Organization base currency not found');
    }

    const [exposures, activeHedges] = await Promise.all([
      this.repository.listFxExposures(organizationId),
      this.repository.listActiveHedges(organizationId)
    ]);

    let totalExposure = '0.000000';
    let totalHedgedAmount = '0.000000';

    const currencyBreakdown = [];

    for (const exposure of exposures) {
      const exposureInBase =
        exposure.currency_code === baseCurrency
          ? exposure.exposure_amount
          : await this.convertAmount(exposure.exposure_amount, exposure.currency_code ?? baseCurrency, baseCurrency);
      const convertedExposure = typeof exposureInBase === 'string' ? exposureInBase : exposureInBase.amount;
      const hedgedAmount = activeHedges
        .filter((hedge) => normalizeHedgeNotional(hedge, exposure.currency_code ?? baseCurrency, baseCurrency) !== '0.000000')
        .reduce((sum, hedge) => addAmounts(sum, normalizeHedgeNotional(hedge, exposure.currency_code ?? baseCurrency, baseCurrency)), '0.000000');
      const hedgedInBase =
        exposure.currency_code === baseCurrency
          ? hedgedAmount
          : await this.convertAmount(hedgedAmount, exposure.currency_code ?? baseCurrency, baseCurrency);
      const convertedHedged = typeof hedgedInBase === 'string' ? hedgedInBase : hedgedInBase.amount;
      const uncovered = subtractAmounts(convertedExposure, convertedHedged);

      totalExposure = addAmounts(totalExposure, convertedExposure);
      totalHedgedAmount = addAmounts(totalHedgedAmount, convertedHedged);

      currencyBreakdown.push({
        currencyCode: exposure.currency_code ?? baseCurrency,
        exposureAmount: exposure.exposure_amount,
        exposureAmountInBaseCurrency: convertedExposure,
        hedgedAmountInBaseCurrency: convertedHedged,
        uncoveredAmountInBaseCurrency: uncovered,
        status: exposure.status
      });
    }

    currencyBreakdown.sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));

    const hedgeCoveragePercent =
      totalExposure === '0.000000' ? '0.00' : formatPercent(divideDecimalStrings(totalHedgedAmount, totalExposure));

    return {
      baseCurrency,
      totalExposure,
      totalHedgedAmount,
      hedgeCoveragePercent,
      uncoveredAmount: subtractAmounts(totalExposure, totalHedgedAmount),
      currencyBreakdown
    };
  }

  async recommendHedges(exposureId: string): Promise<HedgeRecommendation[]> {
    const organizationId = this.requireOrganizationId();
    const exposure = await this.repository.getExposureById(exposureId, organizationId);
    if (!exposure || exposure.risk_type !== 'fx') {
      throw new NotFoundError('FX exposure not found');
    }

    const baseCurrency = await this.repository.getOrganizationBaseCurrency(organizationId);
    if (!baseCurrency || !exposure.currency_code) {
      throw new NotFoundError('Base currency or exposure currency not found');
    }

    const exposureCurrency = exposure.currency_code;
    const details = (exposure.details ?? {}) as Record<string, unknown>;
    const targetHedgeRatio = typeof details.targetHedgeRatio === 'number'
      ? details.targetHedgeRatio.toFixed(6)
      : DEFAULT_TARGET_HEDGE_RATIO;
    const maturityDate = typeof details.maturityDate === 'string' ? details.maturityDate : exposure.reference_date;
    const activeHedges = await this.repository.listActiveHedges(organizationId);
    const currentHedgedAmount = activeHedges
      .filter((hedge) => normalizeHedgeNotional(hedge, exposureCurrency, baseCurrency) !== '0.000000')
      .reduce((sum, hedge) => addAmounts(sum, normalizeHedgeNotional(hedge, exposureCurrency, baseCurrency)), '0.000000');
    const targetHedgedAmount = multiplyDecimalStrings(exposure.exposure_amount, targetHedgeRatio);
    const recommendedNotional = subtractAmounts(targetHedgedAmount, currentHedgedAmount);
    const currentCoveragePercent = formatPercent(divideDecimalStrings(currentHedgedAmount, exposure.exposure_amount));
    const targetCoveragePercent = formatPercent(targetHedgeRatio);
    const projectedCoveragePercent = formatPercent(divideDecimalStrings(targetHedgedAmount, exposure.exposure_amount));
    const tenorDays = Math.max(
      0,
      Math.round(
        (new Date(`${maturityDate}T00:00:00.000Z`).getTime() - new Date(this.now().toISOString()).getTime()) / 86_400_000
      )
    );
    const instrumentType = tenorDays > 90 ? 'swap' : 'forward';

    return [
      {
        exposureId,
        instrumentType,
        baseCurrency: exposureCurrency,
        quoteCurrency: baseCurrency,
        recommendedNotional,
        currentCoveragePercent,
        targetCoveragePercent,
        projectedCoveragePercent,
        maturityDate,
        rationale: `Raise hedge coverage from ${currentCoveragePercent}% to ${targetCoveragePercent}% with a ${instrumentType} maturing on ${maturityDate}; tenor is ${tenorDays} days.`
      }
    ];
  }

  private requireOrganizationId(): string {
    if (!this.organizationId) {
      throw new ValidationError('Organization context is required for this FX operation');
    }

    return this.organizationId;
  }
}
