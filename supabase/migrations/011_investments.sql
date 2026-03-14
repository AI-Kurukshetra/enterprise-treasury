BEGIN;

CREATE TABLE IF NOT EXISTS public.investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instrument_name text NOT NULL CHECK (length(trim(instrument_name)) > 0),
  instrument_type public.investment_type_enum NOT NULL,
  principal_amount numeric(20,6) NOT NULL CHECK (principal_amount > 0),
  currency_code public.currency_code NOT NULL,
  rate numeric(10,6),
  start_date date NOT NULL,
  maturity_date date NOT NULL,
  status public.investment_status_enum NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_investments_maturity_window CHECK (maturity_date >= start_date),
  CONSTRAINT chk_investments_rate CHECK (rate IS NULL OR (rate >= 0 AND rate <= 100)),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_investments_org_status_maturity
  ON public.investments (organization_id, status, maturity_date);

CREATE INDEX IF NOT EXISTS idx_investments_org_type_start
  ON public.investments (organization_id, instrument_type, start_date DESC);

DROP TRIGGER IF EXISTS trg_investments_set_updated_at ON public.investments;
CREATE TRIGGER trg_investments_set_updated_at
BEFORE UPDATE ON public.investments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
