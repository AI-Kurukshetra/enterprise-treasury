import { logger } from '@/lib/logger';
import type { FxProviderInterface } from '@/lib/fx-providers/fx-provider.interface';
import {
  buildFxRateFromSnapshot,
  buildFxRateMapFromSnapshot,
  normalizeCurrencyCode,
  normalizeRateNumber,
  type NormalizedRatesSnapshot
} from '@/lib/fx-providers/provider-utils';
import type { FxRate } from '@/types/fx/types';

const ECB_ENDPOINT = 'https://data-api.ecb.europa.eu/service/data/EXR/D.*.EUR.SP00.A';
const ECB_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const ECB_TIMEOUT_MS = 5_000;

let cachedSnapshot: NormalizedRatesSnapshot | null = null;
let lastKnownSnapshot: NormalizedRatesSnapshot | null = null;

function parseEcbXml(xml: string): NormalizedRatesSnapshot {
  const seriesPattern = /<[\w:-]*Series\b[^>]*>([\s\S]*?)<\/[\w:-]*Series>/g;
  const eurToQuote: Record<string, number> = { EUR: 1 };
  let latestDate = '1970-01-01';

  for (const match of xml.matchAll(seriesPattern)) {
    const block = match[1] ?? '';
    const currencyMatch = block.match(/<[\w:-]*Value\b[^>]*id="CURRENCY"[^>]*value="([A-Z]{3})"/);
    if (!currencyMatch) {
      continue;
    }

    let latestObservation: { date: string; rate: string } | null = null;
    for (const observation of block.matchAll(
      /<[\w:-]*Obs\b[^>]*>[\s\S]*?<[\w:-]*ObsDimension\b[^>]*value="(\d{4}-\d{2}-\d{2})"[\s\S]*?<[\w:-]*ObsValue\b[^>]*value="([0-9.]+)"/g
    )) {
      const [date, rate] = [observation[1], observation[2]];
      if (!date || !rate) {
        continue;
      }
      if (!latestObservation || date > latestObservation.date) {
        latestObservation = { date, rate };
      }
    }

    if (!latestObservation) {
      continue;
    }

    const currencyCodeValue = currencyMatch[1];
    if (!currencyCodeValue) {
      continue;
    }

    const currencyCode = normalizeCurrencyCode(currencyCodeValue);
    eurToQuote[currencyCode] = normalizeRateNumber(Number(latestObservation.rate));
    if (latestObservation.date > latestDate) {
      latestDate = latestObservation.date;
    }
  }

  const eurToUsd = eurToQuote.USD;
  if (!eurToUsd) {
    throw new Error('ECB response did not contain a USD reference rate');
  }

  const usdPerCurrency: Record<string, number> = { USD: 1, EUR: normalizeRateNumber(eurToUsd) };
  for (const [currencyCode, eurQuoteRate] of Object.entries(eurToQuote)) {
    if (currencyCode === 'USD') {
      continue;
    }

    usdPerCurrency[currencyCode] =
      currencyCode === 'EUR'
        ? normalizeRateNumber(eurToUsd)
        : normalizeRateNumber(eurToUsd / eurQuoteRate);
  }

  return {
    asOf: `${latestDate}T00:00:00.000Z`,
    fetchedAt: Date.now(),
    source: 'ecb',
    usdPerCurrency
  };
}

export class EuropeanCentralBankProvider implements FxProviderInterface {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

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
    if (cachedSnapshot && Date.now() - cachedSnapshot.fetchedAt < ECB_CACHE_TTL_MS) {
      return cachedSnapshot;
    }

    try {
      const response = await this.fetchImpl(ECB_ENDPOINT, {
        headers: {
          Accept: 'application/xml'
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(ECB_TIMEOUT_MS)
      });

      if (!response.ok) {
        throw new Error(`ECB request failed with status ${response.status}`);
      }

      const xmlPayload = await response.text();
      const snapshot = parseEcbXml(xmlPayload);
      cachedSnapshot = snapshot;
      lastKnownSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      if (lastKnownSnapshot) {
        logger.warn('fx_provider_ecb_fallback_last_known', {
          reason: error instanceof Error ? error.message : 'Unknown ECB fetch failure',
          asOf: lastKnownSnapshot.asOf
        });
        cachedSnapshot = lastKnownSnapshot;
        return lastKnownSnapshot;
      }

      throw error;
    }
  }
}
