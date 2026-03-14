import { z } from 'zod';
import { CurrencyCodeSchema } from '@/utils/money';

export const CreateForecastRequestSchema = z.object({
  forecastType: z.enum(['short_term', 'long_term']),
  horizon: z.coerce.number().int().min(1).max(365),
  currencyCode: CurrencyCodeSchema,
  scenarioName: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(2_000).optional()
});

export const GenerateForecastScenarioRequestSchema = z.object({
  inflow_change_pct: z.coerce.number().min(-100).max(500),
  outflow_change_pct: z.coerce.number().min(-100).max(500),
  scenario_name: z.string().trim().min(1).max(120)
});

export const ListForecastsQuerySchema = z.object({
  type: z.enum(['short_term', 'long_term']).optional(),
  status: z.enum(['draft', 'published', 'superseded']).optional(),
  generationStatus: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});
