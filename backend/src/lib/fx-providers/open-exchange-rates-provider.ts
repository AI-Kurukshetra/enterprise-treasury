import { getEnv } from '@/config/env';
import type { FxProviderInterface } from '@/lib/fx-providers/fx-provider.interface';
import {
  buildFxRateFromSnapshot,
  buildFxRateMapFromSnapshot,
  normalizeCurrencyCode,
  normalizeRateNumber,
  type NormalizedRatesSnapshot
} from '@/lib/fx-providers/provider-utils';
import type { FxRate } from '@/types/fx/types';

const OPEN_EXCHANGE_RATES_CACHE_TTL_MS = 60 * 60 * 1000;
const OPEN_EXCHANGE_RATES_TIMEOUT_MS = 5_000;

interface OpenExchangeRatesResponse {
  timestamp: number;
  base: string;
  rates: Record<string, number>;
}

let cachedSnapshot: NormalizedRatesSnapshot | null = null;

function buildSnapshotFromResponse(payload: OpenExchangeRatesResponse): NormalizedRatesSnapshot {
  const usdPerCurrency: Record<string, number> = { USD: 1 };

  for (const [currencyCodeRaw, quotePerUsd] of Object.entries(payload.rates)) {
    const currencyCode = normalizeCurrencyCode(currencyCodeRaw);
    if (currencyCode === 'USD') {
      usdPerCurrency.USD = 1;
      continue;
    }

    usdPerCurrency[currencyCode] = normalizeRateNumber(1 / quotePerUsd);
  }

  return {
    asOf: new Date(payload.timestamp * 1_000).toISOString(),
    fetchedAt: Date.now(),
    source: 'open_exchange_rates',
    usdPerCurrency
  };
}

export class OpenExchangeRatesProvider implements FxProviderInterface {
  private readonly appId: string;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    appId = getEnv().OPEN_EXCHANGE_RATES_APP_ID
  ) {
    if (!appId) {
      throw new Error('OPEN_EXCHANGE_RATES_APP_ID is required for OpenExchangeRatesProvider');
    }

    this.appId = appId;
  }

  async getRate(base: string, quote: string): Promise<FxRate> {
    const snapshot = await this.getSnapshot();
    return buildFxRateFromSnapshot(snapshot, base, quote);
  }

  async getRates(base: string): Promise<Record<string, FxRate>> {
    const snapshot = await this.getSnapshot();
    return buildFxRateMapFromSnapshot(snapshot, base);
  }

  async getSupportedCurrencies(): Promise<string[]> {
    const snapshot = await this.getSnapshot();
    return Object.keys(snapshot.usdPerCurrency).sort();
  }

  private async getSnapshot(): Promise<NormalizedRatesSnapshot> {
    if (cachedSnapshot && Date.now() - cachedSnapshot.fetchedAt < OPEN_EXCHANGE_RATES_CACHE_TTL_MS) {
      return cachedSnapshot;
    }

    const response = await this.fetchImpl(
      `https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(this.appId)}`,
      {
        cache: 'no-store',
        signal: AbortSignal.timeout(OPEN_EXCHANGE_RATES_TIMEOUT_MS)
      }
    );

    if (!response.ok) {
      throw new Error(`OpenExchangeRates request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OpenExchangeRatesResponse;
    const snapshot = buildSnapshotFromResponse(payload);
    cachedSnapshot = snapshot;
    return snapshot;
  }
}
