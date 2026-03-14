\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.organizations (id, name, base_currency, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'RLS Org A', 'USD', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'RLS Org B', 'USD', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, email)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'rls-user-a@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'rls-user-b@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roles (id, organization_id, name, is_system)
VALUES
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'member', false),
  ('bbbbbbbb-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'member', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_memberships (id, organization_id, user_id, role_id, status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-1111-1111-1111-111111111111', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-2222-2222-2222-222222222222', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.cash_positions (
  id,
  organization_id,
  as_of_at,
  scope_type,
  scope_id,
  currency_code,
  available_balance,
  current_balance,
  source_version
)
VALUES
  ('aaaaaaaa-aaaa-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', '2026-01-01T00:00:00Z', 'organization', NULL, 'USD', 100.000000, 100.000000, 'rls_test'),
  ('bbbbbbbb-bbbb-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', '2026-01-01T00:00:00Z', 'organization', NULL, 'USD', 200.000000, 200.000000, 'rls_test')
ON CONFLICT (id) DO UPDATE
SET
  organization_id = excluded.organization_id,
  as_of_at = excluded.as_of_at,
  scope_type = excluded.scope_type,
  scope_id = excluded.scope_id,
  currency_code = excluded.currency_code,
  available_balance = excluded.available_balance,
  current_balance = excluded.current_balance,
  source_version = excluded.source_version;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.cash_positions;

  IF v_count < 1 THEN
    RAISE EXCEPTION 'RLS failure: expected at least 1 visible cash_positions row for user A, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.cash_positions
  WHERE organization_id = '11111111-1111-1111-1111-111111111111';

  IF v_count < 1 THEN
    RAISE EXCEPTION 'RLS failure: user A cannot read own organization rows from cash_positions';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.cash_positions
  WHERE organization_id = '22222222-2222-2222-2222-222222222222';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'RLS failure: user A can read org B rows from cash_positions';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.cash_positions_latest
  WHERE organization_id = '22222222-2222-2222-2222-222222222222';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'RLS failure: user A can read org B rows from cash_positions_latest view';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
