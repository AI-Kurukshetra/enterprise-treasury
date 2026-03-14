import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';
import { CurrencyCodeSchema } from '@/utils/money';

const FxExposureResponseSchema = z.object({
  baseCurrency: CurrencyCodeSchema,
  totalExposure: z.string(),
  totalHedgedAmount: z.string(),
  hedgeCoveragePercent: z.string(),
  uncoveredAmount: z.string(),
  currencyBreakdown: z.array(
    z.object({
      currencyCode: CurrencyCodeSchema,
      exposureAmount: z.string(),
      exposureAmountInBaseCurrency: z.string(),
      hedgedAmountInBaseCurrency: z.string(),
      uncoveredAmountInBaseCurrency: z.string(),
      status: z.enum(['normal', 'warning', 'breached'])
    })
  )
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = parseResponse(await services.fx.getExposureSummary(), FxExposureResponseSchema);

    return ok(result, context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
