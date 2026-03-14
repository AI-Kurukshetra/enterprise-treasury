import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';
import { CurrencyCodeSchema } from '@/utils/money';

const RecommendationRequestSchema = z.object({
  exposureId: z.string().uuid()
});

const RecommendationSchema = z.object({
  generatedAt: z.string(),
  recommendations: z.array(
    z.object({
      exposureId: z.string().uuid(),
      instrumentType: z.enum(['forward', 'swap']),
      baseCurrency: CurrencyCodeSchema,
      quoteCurrency: CurrencyCodeSchema,
      recommendedNotional: z.string(),
      currentCoveragePercent: z.string(),
      targetCoveragePercent: z.string(),
      projectedCoveragePercent: z.string(),
      maturityDate: z.string().date(),
      rationale: z.string(),
    })
  )
});

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'risk.hedging.recommend' }, async (_req, context) => {
    const body = await parseJsonBody(request, RecommendationRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = parseResponse(
      {
        generatedAt: new Date().toISOString(),
        recommendations: await services.fx.recommendHedges(body.exposureId)
      },
      RecommendationSchema
    );

    return ok(result, context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
