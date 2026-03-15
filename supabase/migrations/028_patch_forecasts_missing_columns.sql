BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. cash_flow_forecasts — add columns required by the backend service
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cash_flow_forecasts
  ADD COLUMN IF NOT EXISTS horizon_days          integer,
  ADD COLUMN IF NOT EXISTS scenario_name         text NOT NULL DEFAULT 'base',
  ADD COLUMN IF NOT EXISTS notes                 text,
  ADD COLUMN IF NOT EXISTS generation_status     text NOT NULL DEFAULT 'completed'
    CHECK (generation_status IN ('queued', 'running', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS estimated_time_seconds integer,
  ADD COLUMN IF NOT EXISTS accuracy_score        numeric(6,4),
  ADD COLUMN IF NOT EXISTS accuracy_details      jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS base_forecast_id      uuid REFERENCES public.cash_flow_forecasts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scenario_parameters   jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS generation_job_id     uuid,
  ADD COLUMN IF NOT EXISTS generation_error      text,
  ADD COLUMN IF NOT EXISTS generated_at          timestamptz,
  ADD COLUMN IF NOT EXISTS ai_summary            text,
  ADD COLUMN IF NOT EXISTS key_risks             text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recommended_actions   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS prompt_context        jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS few_shot_examples     jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS published_at          timestamptz,
  ADD COLUMN IF NOT EXISTS published_by          uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- back-fill scenario_name for existing rows
UPDATE public.cash_flow_forecasts
  SET scenario_name = 'base'
  WHERE scenario_name IS NULL OR scenario_name = '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. cash_flow_forecast_lines — add columns required by the backend service
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cash_flow_forecast_lines
  ADD COLUMN IF NOT EXISTS cumulative_balance numeric(20,6),
  ADD COLUMN IF NOT EXISTS confidence_score   numeric(6,4),
  ADD COLUMN IF NOT EXISTS key_drivers        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS balance_low        numeric(20,6),
  ADD COLUMN IF NOT EXISTS balance_high       numeric(20,6);

COMMIT;
