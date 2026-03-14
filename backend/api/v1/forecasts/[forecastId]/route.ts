import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const ForecastLineSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  forecast_id: z.string().uuid(),
  forecast_date: z.string(),
  projected_inflow: z.string(),
  projected_outflow: z.string(),
  projected_net: z.string(),
  cumulative_balance: z.string().nullable(),
  confidence_score: z.string().nullable(),
  key_drivers: z.array(z.string()),
  balance_low: z.string().nullable(),
  balance_high: z.string().nullable(),
  scenario: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});

const ForecastDetailSchema = z.object({
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
  base_forecast_id: z.string().uuid().nullable(),
  scenario_parameters: z.record(z.unknown()),
  generation_status: z.enum(['queued', 'running', 'completed', 'failed']),
  generation_job_id: z.string().uuid().nullable(),
  generation_error: z.string().nullable(),
  estimated_time_seconds: z.number().int().nullable(),
  generated_at: z.string().nullable(),
  ai_summary: z.string().nullable(),
  key_risks: z.array(z.string()),
  recommended_actions: z.array(z.string()),
  prompt_context: z.record(z.unknown()),
  few_shot_examples: z.array(z.unknown()),
  accuracy_score: z.string().nullable(),
  accuracy_details: z.record(z.unknown()),
  published_at: z.string().nullable(),
  published_by: z.string().uuid().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  lines: z.array(ForecastLineSchema)
});

interface RouteParams {
  params: Promise<{ forecastId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, {}, async (_req, context) => {
    const { forecastId } = await params;
    const services = buildServices(toServiceContext(context));
    const forecast = await services.forecasts.getById(forecastId);
    return ok(parseResponse(forecast, ForecastDetailSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
