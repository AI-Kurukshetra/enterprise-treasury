\set ON_ERROR_STOP on

BEGIN;

SELECT public.create_transaction_month_partition('2033-04-01'::date);

DO $$
DECLARE
  v_exists boolean;
  v_is_partition boolean;
  v_relrowsecurity boolean;
  v_relforcerowsecurity boolean;
  v_policy_count integer;
  v_index_count integer;
  v_bound text;
  v_default_exists boolean;
BEGIN
  SELECT to_regclass('public.transactions_2033_04') IS NOT NULL
    INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'Expected partition public.transactions_2033_04 to exist';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_inherits i
    WHERE i.inhparent = 'public.transactions'::regclass
      AND i.inhrelid = 'public.transactions_2033_04'::regclass
  )
  INTO v_is_partition;

  IF NOT v_is_partition THEN
    RAISE EXCEPTION 'transactions_2033_04 is not attached to transactions parent';
  END IF;

  SELECT c.relrowsecurity, c.relforcerowsecurity
    INTO v_relrowsecurity, v_relforcerowsecurity
  FROM pg_class c
  WHERE c.oid = 'public.transactions_2033_04'::regclass;

  IF NOT v_relrowsecurity OR NOT v_relforcerowsecurity THEN
    RAISE EXCEPTION 'Expected RLS + FORCE RLS on transactions_2033_04';
  END IF;

  SELECT count(*)
    INTO v_policy_count
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename = 'transactions_2033_04'
    AND p.policyname IN (
      'service_role_all',
      'org_member_select',
      'org_member_insert',
      'org_member_update',
      'org_member_delete'
    );

  IF v_policy_count <> 5 THEN
    RAISE EXCEPTION 'Expected 5 RLS policies on transactions_2033_04, got %', v_policy_count;
  END IF;

  SELECT count(*)
    INTO v_index_count
  FROM pg_indexes pi
  WHERE pi.schemaname = 'public'
    AND pi.tablename = 'transactions_2033_04'
    AND pi.indexname IN (
      'idx_transactions_2033_04_org_booking',
      'idx_transactions_2033_04_org_account_booking'
    );

  IF v_index_count <> 2 THEN
    RAISE EXCEPTION 'Expected partition indexes to be present on transactions_2033_04, got %', v_index_count;
  END IF;

  SELECT pg_get_expr(c.relpartbound, c.oid)
    INTO v_bound
  FROM pg_class c
  WHERE c.oid = 'public.transactions_2033_04'::regclass;

  IF v_bound IS NULL
     OR position('2033-04-01' in v_bound) = 0
     OR position('2033-05-01' in v_bound) = 0 THEN
    RAISE EXCEPTION 'Unexpected monthly partition bounds for transactions_2033_04: %', v_bound;
  END IF;

  SELECT to_regclass('public.transactions_default') IS NOT NULL
    INTO v_default_exists;

  IF NOT v_default_exists THEN
    RAISE EXCEPTION 'Expected fallback partition public.transactions_default to exist';
  END IF;
END;
$$;

ROLLBACK;
