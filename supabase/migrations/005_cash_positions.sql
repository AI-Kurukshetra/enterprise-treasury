BEGIN;

CREATE TABLE IF NOT EXISTS public.cash_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  as_of_at timestamptz NOT NULL,
  scope_type public.cash_scope_type_enum NOT NULL,
  scope_id uuid,
  currency_code public.currency_code NOT NULL,
  available_balance numeric(20,6) NOT NULL,
  current_balance numeric(20,6) NOT NULL,
  source_version text NOT NULL CHECK (length(trim(source_version)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, as_of_at, scope_type, scope_id, currency_code),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_cash_positions_org_scope_as_of
  ON public.cash_positions (organization_id, scope_type, scope_id, as_of_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_positions_org_currency_as_of
  ON public.cash_positions (organization_id, currency_code, as_of_at DESC);

CREATE OR REPLACE VIEW public.cash_positions_latest AS
SELECT DISTINCT ON (cp.organization_id, cp.scope_type, cp.scope_id, cp.currency_code)
  cp.id,
  cp.organization_id,
  cp.as_of_at,
  cp.scope_type,
  cp.scope_id,
  cp.currency_code,
  cp.available_balance,
  cp.current_balance,
  cp.source_version,
  cp.created_at,
  cp.updated_at
FROM public.cash_positions cp
ORDER BY cp.organization_id, cp.scope_type, cp.scope_id, cp.currency_code, cp.as_of_at DESC;

DROP TRIGGER IF EXISTS trg_cash_positions_set_updated_at ON public.cash_positions;
CREATE TRIGGER trg_cash_positions_set_updated_at
BEFORE UPDATE ON public.cash_positions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
