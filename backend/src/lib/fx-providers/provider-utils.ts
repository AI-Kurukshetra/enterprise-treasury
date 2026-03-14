import { CurrencyCodeSchema } from '@/utils/money';
import type { FxRate } from '@/types/fx/types';

export interface NormalizedRatesSnapshot {
  asOf: string;
  fetchedAt: number;
  source: string;
  usdPerCurrency: Record<string, number>;
}

export function normalizeCurrencyCode(currencyCode: string): string {
  return CurrencyCodeSchema.parse(currencyCode);
}

export function normalizeRateNumber(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Invalid FX rate received: ${rate}`);
  }

  return Number(rate.toFixed(8));
}

export function buildFxRateFromSnapshot(
  snapshot: NormalizedRatesSnapshot,
  baseCurrency: string,
  quoteCurrency: string
): FxRate {
  const normalizedBase = normalizeCurrencyCode(baseCurrency);
  const normalizedQuote = normalizeCurrencyCode(quoteCurrency);

  if (normalizedBase === normalizedQuote) {
    return {
      baseCurrency: normalizedBase,
      quoteCurrency: normalizedQuote,
      rate: 1,
      timestamp: snapshot.asOf,
      source: snapshot.source
    };
  }

  const usdPerBase = snapshot.usdPerCurrency[normalizedBase];
  const usdPerQuote = snapshot.usdPerCurrency[normalizedQuote];

  if (!usdPerBase || !usdPerQuote) {
    throw new Error(`Unsupported currency pair: ${normalizedBase}/${normalizedQuote}`);
  }

  return {
    baseCurrency: normalizedBase,
    quoteCurrency: normalizedQuote,
    rate: normalizeRateNumber(usdPerBase / usdPerQuote),
    timestamp: snapshot.asOf,
    source: snapshot.source
  };
}

export function buildFxRateMapFromSnapshot(
  snapshot: NormalizedRatesSnapshot,
  baseCurrency: string
): Record<string, FxRate> {
  const normalizedBase = normalizeCurrencyCode(baseCurrency);
  const rates: Record<string, FxRate> = {};

  for (const currencyCode of Object.keys(snapshot.usdPerCurrency).sort()) {
    rates[currencyCode] = buildFxRateFromSnapshot(snapshot, normalizedBase, currencyCode);
  }

  return rates;
}
