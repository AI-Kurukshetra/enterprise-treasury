BEGIN;

CREATE TABLE IF NOT EXISTS public.cash_flow_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  forecast_type public.forecast_type_enum NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  currency_code public.currency_code NOT NULL,
  model_type public.forecast_model_type_enum NOT NULL,
  model_version text NOT NULL CHECK (length(trim(model_version)) > 0),
  confidence_score numeric(6,4),
  status public.forecast_status_enum NOT NULL DEFAULT 'draft',
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cash_flow_forecasts_date_window CHECK (end_date >= start_date),
  CONSTRAINT chk_cash_flow_forecasts_confidence_score
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.cash_flow_forecast_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  forecast_id uuid NOT NULL,
  forecast_date date NOT NULL,
  projected_inflow numeric(20,6) NOT NULL DEFAULT 0,
  projected_outflow numeric(20,6) NOT NULL DEFAULT 0,
  projected_net numeric(20,6) NOT NULL,
  scenario text NOT NULL DEFAULT 'base' CHECK (length(trim(scenario)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_forecast_lines_forecast_org
    FOREIGN KEY (forecast_id, organization_id)
    REFERENCES public.cash_flow_forecasts (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT chk_cash_flow_forecast_lines_net
    CHECK (projected_net = projected_inflow - projected_outflow),
  UNIQUE (organization_id, forecast_id, forecast_date, scenario),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_cash_forecasts_org_status_dates
  ON public.cash_flow_forecasts (organization_id, status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_forecast_lines_org_forecast_date
  ON public.cash_flow_forecast_lines (organization_id, forecast_id, forecast_date);

CREATE OR REPLACE FUNCTION public.cash_flow_forecast_lines_set_net()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.projected_net := NEW.projected_inflow - NEW.projected_outflow;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_flow_forecasts_set_updated_at ON public.cash_flow_forecasts;
CREATE TRIGGER trg_cash_flow_forecasts_set_updated_at
BEFORE UPDATE ON public.cash_flow_forecasts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_cash_flow_forecast_lines_set_updated_at ON public.cash_flow_forecast_lines;
CREATE TRIGGER trg_cash_flow_forecast_lines_set_updated_at
BEFORE INSERT OR UPDATE ON public.cash_flow_forecast_lines
FOR EACH ROW EXECUTE FUNCTION public.cash_flow_forecast_lines_set_net();

COMMIT;
