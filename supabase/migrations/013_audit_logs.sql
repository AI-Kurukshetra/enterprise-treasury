BEGIN;

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(trim(action)) > 0),
  entity_type text NOT NULL CHECK (length(trim(entity_type)) > 0),
  entity_id uuid,
  previous_state jsonb,
  new_state jsonb,
  request_id text,
  source_channel text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_occurred
  ON public.audit_logs (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_entity_occurred
  ON public.audit_logs (organization_id, entity_type, entity_id, occurred_at DESC);

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
  v_user_id uuid;
  v_request_id text;
BEGIN
  v_user_id := COALESCE(p_user_id, public.current_actor_user_id());
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

CREATE OR REPLACE FUNCTION public.capture_audit_log_from_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_text text;
  v_org_id uuid;
  v_entity_text text;
  v_entity_id uuid;
BEGIN
  v_org_text := COALESCE(
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ->> 'organization_id' ELSE NULL END,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ->> 'organization_id' ELSE NULL END
  );

  IF v_org_text IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN
    v_org_id := v_org_text::uuid;
  EXCEPTION WHEN others THEN
    RETURN COALESCE(NEW, OLD);
  END;

  v_entity_text := COALESCE(
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ->> 'id' ELSE NULL END,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ->> 'id' ELSE NULL END
  );

  IF v_entity_text IS NOT NULL THEN
    BEGIN
      v_entity_id := v_entity_text::uuid;
    EXCEPTION WHEN others THEN
      v_entity_id := NULL;
    END;
  END IF;

  PERFORM public.log_audit_event(
    p_organization_id := v_org_id,
    p_action := lower(TG_OP),
    p_entity_type := TG_TABLE_NAME,
    p_entity_id := v_entity_id,
    p_previous_state := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    p_new_state := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable and cannot be %', lower(TG_OP)
    USING ERRCODE = '22000';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
BEFORE UPDATE OR DELETE ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'organizations',
    'users',
    'roles',
    'role_permissions',
    'organization_memberships',
    'bank_connections',
    'bank_accounts',
    'counterparties',
    'bank_statement_import_jobs',
    'transaction_dedupe_keys',
    'transaction_source_events',
    'transactions',
    'cash_positions',
    'cash_flow_forecasts',
    'cash_flow_forecast_lines',
    'idempotency_keys',
    'payments',
    'approval_workflows',
    'approval_steps',
    'payment_approvals',
    'liquidity_pools',
    'liquidity_pool_accounts',
    'sweeping_rules',
    'intercompany_transactions',
    'risk_exposures',
    'hedging_instruments',
    'investments',
    'debt_facilities',
    'debt_schedules'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON public.%I', v_table, v_table);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log_from_row()',
      v_table,
      v_table
    );
  END LOOP;
END;
$$;

COMMIT;
