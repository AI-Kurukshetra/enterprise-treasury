import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const RegionalBreakdownSchema = z.object({
  region: z.string(),
  operating: z.string(),
  reserve: z.string(),
  trapped: z.string()
});

const TrendPointSchema = z.object({
  label: z.string(),
  value: z.string(),
  projected: z.string(),
  buffer: z.string()
});

const PaymentVolumePointSchema = z.object({
  label: z.string(),
  urgent: z.number().int().nonnegative(),
  scheduled: z.number().int().nonnegative()
});

const CashPositionSummarySchema = z.object({
  totalCash: z.string(),
  availableLiquidity: z.string(),
  pendingPayments: z.object({
    amount: z.string(),
    count: z.number().int().nonnegative()
  }),
  riskLimitsInWatch: z.number().int().nonnegative(),
  baseCurrency: z.string().length(3),
  asOf: z.string(),
  byRegion: z.array(RegionalBreakdownSchema),
  trend: z.array(TrendPointSchema),
  paymentVolume: z.array(PaymentVolumePointSchema)
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.cashPositions.getLatest();
    return ok(parseResponse(result, CashPositionSummarySchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
