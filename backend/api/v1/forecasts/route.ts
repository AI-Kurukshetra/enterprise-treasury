import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { ListForecastsQuerySchema, CreateForecastRequestSchema } from '@/schemas/forecasts/schema';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const ForecastSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  forecast_type: z.enum(['short_term', 'long_term']),
  start_date: z.string(),
  end_date: z.string(),
  horizon_days: z.number().int().nullable(),
  currency_code: z.string().length(3),
  model_type: z.enum(['statistical', 'ai_hybrid']),
  model_version: z.string(),
  confidence_score: z.string().nullable(),
  status: z.enum(['draft', 'published', 'superseded']),
  scenario_name: z.string(),
  notes: z.string().nullable(),
  generation_status: z.enum(['queued', 'running', 'completed', 'failed']),
  estimated_time_seconds: z.number().int().nullable(),
  accuracy_score: z.string().nullable(),
  accuracy_details: z.record(z.unknown()),
  created_at: z.string(),
  updated_at: z.string()
});

const ListForecastsResponseSchema = z.object({
  items: z.array(ForecastSchema),
  nextCursor: z.string().nullable()
});

const ForecastGenerationResponseSchema = z.object({
  forecastId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  estimatedTimeSeconds: z.number().int().positive()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, ListForecastsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.forecasts.list(
      {
        type: query.type,
        status: query.status,
        generationStatus: query.generationStatus,
        fromDate: query.fromDate,
        toDate: query.toDate
      },
      { cursor: query.cursor, limit: query.limit }
    );
    return ok(parseResponse(result, ListForecastsResponseSchema), context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(
    request,
    { requiredPermission: 'forecasts.create', useIdempotency: true, rateLimit: 'api.sensitive' },
    async (_req, context) => {
      const body = await parseJsonBody(request, CreateForecastRequestSchema);
      const services = buildServices(toServiceContext(context));
      const result = await services.forecasts.create(body, context.idempotencyKey!);
      const statusCode = result.status === 'queued' ? 202 : 201;
      return ok(parseResponse(result, ForecastGenerationResponseSchema), context.requestId, statusCode);
    }
  );
}

export const OPTIONS = buildOptionsHandler();
