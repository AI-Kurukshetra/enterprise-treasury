BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'intercompany_transactions'
      AND column_name = 'interest_rate'
      AND (numeric_precision, numeric_scale) IS DISTINCT FROM (20, 6)
  ) THEN
    ALTER TABLE public.intercompany_transactions
      ALTER COLUMN interest_rate TYPE numeric(20,6)
      USING round(interest_rate::numeric, 6);
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'investments'
      AND column_name = 'rate'
      AND (numeric_precision, numeric_scale) IS DISTINCT FROM (20, 6)
  ) THEN
    ALTER TABLE public.investments
      ALTER COLUMN rate TYPE numeric(20,6)
      USING round(rate::numeric, 6);
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hedging_instruments'
      AND column_name = 'strike_rate'
      AND (numeric_precision, numeric_scale) IS DISTINCT FROM (20, 6)
  ) THEN
    ALTER TABLE public.hedging_instruments
      ALTER COLUMN strike_rate TYPE numeric(20,6)
      USING round(strike_rate::numeric, 6);
  END IF;
END;
$$;

ALTER VIEW public.cash_positions_latest SET (security_invoker = true);
REVOKE ALL ON TABLE public.cash_positions_latest FROM PUBLIC;
REVOKE ALL ON TABLE public.cash_positions_latest FROM anon;
REVOKE ALL ON TABLE public.cash_positions_latest FROM authenticated;
GRANT SELECT ON TABLE public.cash_positions_latest TO authenticated;
GRANT SELECT ON TABLE public.cash_positions_latest TO service_role;

CREATE OR REPLACE FUNCTION public.is_org_member(p_user_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
BEGIN
  IF p_user_id IS NULL OR p_org_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_role = 'service_role' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.organization_memberships om
      WHERE om.user_id = p_user_id
        AND om.organization_id = p_org_id
        AND om.status = 'active'
    );
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = p_org_id
      AND om.status = 'active'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.has_org_permission(
  p_user_id uuid,
  p_org_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), '');
  v_lookup_user_id uuid;
BEGIN
  IF p_org_id IS NULL OR p_permission_key IS NULL THEN
    RETURN false;
  END IF;

  IF v_role = 'service_role' THEN
    v_lookup_user_id := p_user_id;
  ELSE
    IF p_user_id IS DISTINCT FROM auth.uid() THEN
      RETURN false;
    END IF;
    v_lookup_user_id := auth.uid();
  END IF;

  IF v_lookup_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    JOIN public.role_permissions rp
      ON rp.role_id = om.role_id
     AND rp.organization_id = om.organization_id
    WHERE om.user_id = v_lookup_user_id
      AND om.organization_id = p_org_id
      AND om.status = 'active'
      AND rp.permission_key = p_permission_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_previous_state jsonb DEFAULT NULL,
  p_new_state jsonb DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_source_channel text DEFAULT 'api',
  p_request_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log_id uuid;
  v_actor_user_id uuid;
  v_user_id uuid;
  v_request_id text;
  v_role text := COALESCE(auth.role(), '');
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id is required for audit log entries'
      USING ERRCODE = '23514';
  END IF;

  v_actor_user_id := public.current_actor_user_id();

  IF v_role <> 'service_role' THEN
    IF NOT (session_user IN ('postgres', 'supabase_admin') AND v_actor_user_id IS NULL) THEN
      IF v_actor_user_id IS NULL OR NOT public.is_org_member(v_actor_user_id, p_organization_id) THEN
        RAISE EXCEPTION 'insufficient privilege to write audit logs for organization %', p_organization_id
          USING ERRCODE = '42501';
      END IF;

      IF p_user_id IS NOT NULL AND p_user_id <> v_actor_user_id THEN
        RAISE EXCEPTION 'audit user_id must match authenticated actor'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  v_user_id := COALESCE(p_user_id, v_actor_user_id);
  v_request_id := COALESCE(
    p_request_id,
    NULLIF(current_setting('request.headers.x-request-id', true), ''),
    NULLIF(current_setting('request.header.x-request-id', true), '')
  );

  INSERT INTO public.audit_logs (
    organization_id,
    user_id,
    action,
    entity_type,
    entity_id,
    previous_state,
    new_state,
    request_id,
    source_channel,
    metadata
  )
  VALUES (
    p_organization_id,
    v_user_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_previous_state,
    p_new_state,
    v_request_id,
    p_source_channel,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_transactions_partition(p_partition regclass)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_schema_name text;
  v_table_name text;
  v_index_name text;
BEGIN
  IF p_partition IS NULL THEN
    RAISE EXCEPTION 'partition relation is required'
      USING ERRCODE = '23514';
  END IF;

  SELECT ns.nspname, c.relname
    INTO v_schema_name, v_table_name
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE c.oid = p_partition;

  IF v_table_name IS NULL THEN
    RAISE EXCEPTION 'partition % does not exist', p_partition
      USING ERRCODE = '42P01';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_inherits i
    WHERE i.inhparent = 'public.transactions'::regclass
      AND i.inhrelid = p_partition
  ) THEN
    RAISE EXCEPTION '% is not a partition of public.transactions', p_partition
      USING ERRCODE = '23514';
  END IF;

  EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema_name, v_table_name);
  EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', v_schema_name, v_table_name);

  EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'service_role_all', v_schema_name, v_table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'org_member_select', v_schema_name, v_table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'org_member_insert', v_schema_name, v_table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'org_member_update', v_schema_name, v_table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'org_member_delete', v_schema_name, v_table_name);

  EXECUTE format(
    'CREATE POLICY %I ON %I.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
    'service_role_all',
    v_schema_name,
    v_table_name
  );

  EXECUTE format(
    'CREATE POLICY %I ON %I.%I FOR SELECT USING (public.is_org_member(auth.uid(), organization_id))',
    'org_member_select',
    v_schema_name,
    v_table_name
  );

  EXECUTE format(
    'CREATE POLICY %I ON %I.%I FOR INSERT WITH CHECK (public.is_org_member(auth.uid(), organization_id))',
    'org_member_insert',
    v_schema_name,
    v_table_name
  );

  EXECUTE format(
    'CREATE POLICY %I ON %I.%I FOR UPDATE USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id))',
    'org_member_update',
    v_schema_name,
    v_table_name
  );

  EXECUTE format(
    'CREATE POLICY %I ON %I.%I FOR DELETE USING (public.is_org_member(auth.uid(), organization_id))',
    'org_member_delete',
    v_schema_name,
    v_table_name
  );

  v_index_name := format('idx_%s_org_booking', v_table_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.%I (organization_id, booking_date DESC)',
    v_index_name,
    v_schema_name,
    v_table_name
  );

  v_index_name := format('idx_%s_org_account_booking', v_table_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.%I (organization_id, bank_account_id, booking_date DESC)',
    v_index_name,
    v_schema_name,
    v_table_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_transaction_month_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_start date;
  v_end date;
  v_name text;
  v_partition regclass;
BEGIN
  v_start := date_trunc('month', p_month)::date;
  v_end := (v_start + INTERVAL '1 month')::date;
  v_name := format('transactions_%s', to_char(v_start, 'YYYY_MM'));

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.transactions FOR VALUES FROM (%L) TO (%L)',
    v_name,
    v_start,
    v_end
  );

  v_partition := to_regclass(format('public.%I', v_name));
  PERFORM public.configure_transactions_partition(v_partition);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_future_transaction_partitions(p_months_ahead integer DEFAULT 18)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_month date;
BEGIN
  IF p_months_ahead < 1 THEN
    RAISE EXCEPTION 'p_months_ahead must be >= 1';
  END IF;

  FOR v_month_offset IN 0..p_months_ahead LOOP
    v_month := (date_trunc('month', now())::date + make_interval(months => v_month_offset))::date;
    PERFORM public.create_transaction_month_partition(v_month);
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_partition regclass;
BEGIN
  FOR v_partition IN
    SELECT i.inhrelid::regclass
    FROM pg_inherits i
    WHERE i.inhparent = 'public.transactions'::regclass
  LOOP
    PERFORM public.configure_transactions_partition(v_partition);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_transactions_partition(regclass) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.configure_transactions_partition(regclass) FROM anon;
REVOKE ALL ON FUNCTION public.configure_transactions_partition(regclass) FROM authenticated;
REVOKE ALL ON FUNCTION public.create_transaction_month_partition(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_transaction_month_partition(date) FROM anon;
REVOKE ALL ON FUNCTION public.create_transaction_month_partition(date) FROM authenticated;
REVOKE ALL ON FUNCTION public.ensure_future_transaction_partitions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_future_transaction_partitions(integer) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_future_transaction_partitions(integer) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.configure_transactions_partition(regclass) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_transaction_month_partition(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_future_transaction_partitions(integer) TO service_role;

COMMIT;
