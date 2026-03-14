BEGIN;

CREATE TABLE IF NOT EXISTS public.risk_exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  risk_type public.risk_type_enum NOT NULL,
  reference_date date NOT NULL,
  currency_code public.currency_code,
  exposure_amount numeric(20,6) NOT NULL,
  var_95 numeric(20,6),
  status public.risk_status_enum NOT NULL DEFAULT 'normal',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.hedging_instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instrument_type public.hedging_instrument_type_enum NOT NULL,
  notional_amount numeric(20,6) NOT NULL CHECK (notional_amount > 0),
  base_currency public.currency_code NOT NULL,
  quote_currency public.currency_code,
  strike_rate numeric(20,10),
  trade_date date NOT NULL DEFAULT current_date,
  maturity_date date NOT NULL,
  status public.hedging_status_enum NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_hedging_instruments_maturity
    CHECK (maturity_date >= trade_date),
  CONSTRAINT chk_hedging_instruments_strike
    CHECK (strike_rate IS NULL OR strike_rate > 0),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_risk_exposures_org_type_ref_date
  ON public.risk_exposures (organization_id, risk_type, reference_date DESC);

CREATE INDEX IF NOT EXISTS idx_risk_exposures_org_status_ref_date
  ON public.risk_exposures (organization_id, status, reference_date DESC);

CREATE INDEX IF NOT EXISTS idx_hedging_instruments_org_status_maturity
  ON public.hedging_instruments (organization_id, status, maturity_date);

DROP TRIGGER IF EXISTS trg_risk_exposures_set_updated_at ON public.risk_exposures;
CREATE TRIGGER trg_risk_exposures_set_updated_at
BEFORE UPDATE ON public.risk_exposures
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_hedging_instruments_set_updated_at ON public.hedging_instruments;
CREATE TRIGGER trg_hedging_instruments_set_updated_at
BEFORE UPDATE ON public.hedging_instruments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
