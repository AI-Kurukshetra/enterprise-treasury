BEGIN;

-- Add restricted_balance column to cash_positions (backend expects it).
ALTER TABLE public.cash_positions
  ADD COLUMN IF NOT EXISTS restricted_balance numeric(20,6) NOT NULL DEFAULT 0;

-- DROP and recreate view — CREATE OR REPLACE cannot add columns mid-list.
DROP VIEW IF EXISTS public.cash_positions_latest;
CREATE VIEW public.cash_positions_latest AS
SELECT DISTINCT ON (cp.organization_id, cp.scope_type, cp.scope_id, cp.currency_code)
  cp.id,
  cp.organization_id,
  cp.as_of_at,
  cp.scope_type,
  cp.scope_id,
  cp.currency_code,
  cp.available_balance,
  cp.current_balance,
  cp.restricted_balance,
  cp.source_version,
  cp.created_at,
  cp.updated_at
FROM public.cash_positions cp
ORDER BY cp.organization_id, cp.scope_type, cp.scope_id, cp.currency_code, cp.as_of_at DESC;

-- Re-apply security settings stripped by CREATE OR REPLACE VIEW.
ALTER VIEW public.cash_positions_latest SET (security_invoker = true);
REVOKE ALL ON TABLE public.cash_positions_latest FROM PUBLIC;
REVOKE ALL ON TABLE public.cash_positions_latest FROM anon;
REVOKE ALL ON TABLE public.cash_positions_latest FROM authenticated;
GRANT SELECT ON TABLE public.cash_positions_latest TO authenticated;
GRANT SELECT ON TABLE public.cash_positions_latest TO service_role;

COMMIT;
