import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';
import { CurrencyCodeSchema } from '@/utils/money';

const RateQuerySchema = z.object({
  base: CurrencyCodeSchema,
  quote: CurrencyCodeSchema.optional(),
  currencies: z.string().optional(),
  asOf: z.string().date().optional()
});

const RateItemSchema = z.object({
  quoteCurrency: CurrencyCodeSchema,
  rate: z.string(),
  timestamp: z.string(),
  source: z.string()
});

const RateResponseSchema = z.object({
  baseCurrency: CurrencyCodeSchema,
  rates: z.array(RateItemSchema)
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, RateQuerySchema);
    const requestedCurrencies = query.currencies
      ? query.currencies.split(',').map((currencyCode) => CurrencyCodeSchema.parse(currencyCode))
      : query.quote
        ? [query.quote]
        : null;
    const services = buildServices(toServiceContext(context));
    const selectedRates = query.asOf && requestedCurrencies
      ? await Promise.all(
          requestedCurrencies.map(async (quoteCurrency) => {
            const rate = await services.fx.getRate({
              base: query.base,
              quote: quoteCurrency,
              asOf: query.asOf
            });
            return {
              quoteCurrency,
              rate: rate.rate.toFixed(8),
              timestamp: rate.timestamp,
              source: rate.source
            };
          })
        )
      : Object.values(await services.fx.getRates(query.base))
          .filter((rate) => (requestedCurrencies ? requestedCurrencies.includes(rate.quoteCurrency) : true))
          .sort((left, right) => left.quoteCurrency.localeCompare(right.quoteCurrency))
          .map((rate) => ({
            quoteCurrency: rate.quoteCurrency,
            rate: rate.rate.toFixed(8),
            timestamp: rate.timestamp,
            source: rate.source
          }));

    if (requestedCurrencies) {
      const missingCurrencies = requestedCurrencies.filter(
        (currencyCode) => !selectedRates.some((rate) => rate.quoteCurrency === currencyCode)
      );
      if (missingCurrencies.length > 0) {
        throw new z.ZodError([
          {
            code: z.ZodIssueCode.custom,
            message: `Unsupported quote currencies requested: ${missingCurrencies.join(', ')}`,
            path: ['currencies']
          }
        ]);
      }
    }

    const response = parseResponse(
      {
        baseCurrency: query.base,
        rates: selectedRates
      },
      RateResponseSchema
    );

    const successResponse = ok(response, context.requestId);
    successResponse.headers.set('Cache-Control', 'public, max-age=3600');
    return successResponse;
  });
}

export const OPTIONS = buildOptionsHandler();
