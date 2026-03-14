import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const ForecastPublishSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['draft', 'published', 'superseded']),
  generation_status: z.enum(['queued', 'running', 'completed', 'failed']),
  published_at: z.string().nullable()
}).passthrough();

interface RouteParams {
  params: Promise<{ forecastId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, { requiredPermission: 'forecasts.publish' }, async (_req, context) => {
    const { forecastId } = await params;
    const services = buildServices(toServiceContext(context));
    const forecast = await services.forecasts.publish(forecastId);
    return ok(parseResponse(forecast, ForecastPublishSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
