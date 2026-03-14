import type { UUID } from '@/types/common';

export type ForecastType = 'short_term' | 'long_term';
export type ForecastStatus = 'draft' | 'published' | 'superseded';
export type ForecastGenerationStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ForecastLine {
  id: UUID;
  organization_id: UUID;
  forecast_id: UUID;
  forecast_date: string;
  projected_inflow: string;
  projected_outflow: string;
  projected_net: string;
  cumulative_balance: string | null;
  confidence_score: string | null;
  key_drivers: string[];
  balance_low: string | null;
  balance_high: string | null;
  scenario: string;
  created_at: string;
  updated_at: string;
}

export interface Forecast {
  id: UUID;
  organization_id: UUID;
  name: string;
  forecast_type: ForecastType;
  start_date: string;
  end_date: string;
  horizon_days: number | null;
  currency_code: string;
  model_type: 'statistical' | 'ai_hybrid';
  model_version: string;
  confidence_score: string | null;
  status: ForecastStatus;
  scenario_name: string;
  notes: string | null;
  base_forecast_id: UUID | null;
  scenario_parameters: Record<string, unknown>;
  generation_status: ForecastGenerationStatus;
  generation_job_id: UUID | null;
  generation_error: string | null;
  estimated_time_seconds: number | null;
  generated_at: string | null;
  ai_summary: string | null;
  key_risks: string[];
  recommended_actions: string[];
  prompt_context: Record<string, unknown>;
  few_shot_examples: unknown[];
  accuracy_score: string | null;
  accuracy_details: Record<string, unknown>;
  published_at: string | null;
  published_by: UUID | null;
  created_by: UUID;
  created_at: string;
  updated_at: string;
}

export interface ForecastDetail extends Forecast {
  lines: ForecastLine[];
}

export interface CreateForecastInput {
  forecastType: ForecastType;
  horizon: number;
  currencyCode: string;
  scenarioName?: string;
  notes?: string;
}

export interface GenerateForecastScenarioInput {
  inflow_change_pct: number;
  outflow_change_pct: number;
  scenario_name: string;
}

export interface ForecastResult {
  forecastId: string;
  status: ForecastGenerationStatus;
  estimatedTimeSeconds: number;
}

export interface ForecastAccuracyMetric {
  forecastId: string;
  forecastDate: string;
  horizonDays: number;
  scenarioName: string;
  forecastType: ForecastType;
  accuracyScore: string | null;
  mapePct: string | null;
  generationStatus: ForecastGenerationStatus;
}
