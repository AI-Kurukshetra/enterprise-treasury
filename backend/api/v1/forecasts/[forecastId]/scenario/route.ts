import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { GenerateForecastScenarioRequestSchema } from '@/schemas/forecasts/schema';
import { buildServices } from '@/services/serviceFactory';

const ScenarioGenerationResponseSchema = z.object({
  forecastId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  estimatedTimeSeconds: z.number().int().positive()
});

interface RouteParams {
  params: Promise<{ forecastId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return executeRoute(
    request,
    { requiredPermission: 'forecasts.create', useIdempotency: true, rateLimit: 'api.sensitive' },
    async (_req, context) => {
      const { forecastId } = await params;
      const body = await parseJsonBody(request, GenerateForecastScenarioRequestSchema);
      const services = buildServices(toServiceContext(context));
      const result = await services.forecasts.generateScenario(forecastId, body, context.idempotencyKey!);
      return ok(parseResponse(result, ScenarioGenerationResponseSchema), context.requestId, 201);
    }
  );
}

export const OPTIONS = buildOptionsHandler();
