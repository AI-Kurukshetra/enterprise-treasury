BEGIN;

CREATE INDEX IF NOT EXISTS idx_transactions_org_account_event_ts
  ON public.transactions (organization_id, bank_account_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_org_direction_booking
  ON public.transactions (organization_id, direction, booking_date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_org_currency_booking
  ON public.transactions (organization_id, currency_code, booking_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_org_status_value_date
  ON public.payments (organization_id, status, value_date);

CREATE INDEX IF NOT EXISTS idx_payments_org_counterparty_status
  ON public.payments (organization_id, beneficiary_counterparty_id, status);

CREATE INDEX IF NOT EXISTS idx_payment_approvals_org_step_decision
  ON public.payment_approvals (organization_id, approval_step_id, decision);

CREATE INDEX IF NOT EXISTS idx_risk_exposures_org_currency_ref_date
  ON public.risk_exposures (organization_id, currency_code, reference_date DESC);

CREATE INDEX IF NOT EXISTS idx_cash_positions_org_as_of
  ON public.cash_positions (organization_id, as_of_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_org_bank_connection
  ON public.bank_accounts (organization_id, bank_connection_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_action_occurred
  ON public.audit_logs (organization_id, action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_intercompany_org_maturity_status
  ON public.intercompany_transactions (organization_id, maturity_date, status);

CREATE OR REPLACE FUNCTION public.create_transaction_month_partition(p_month date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_start date;
  v_end date;
  v_name text;
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
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_future_transaction_partitions(p_months_ahead integer DEFAULT 18)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_i integer;
  v_month date;
BEGIN
  IF p_months_ahead < 1 THEN
    RAISE EXCEPTION 'p_months_ahead must be >= 1';
  END IF;

  FOR v_i IN 0..p_months_ahead LOOP
    v_month := (date_trunc('month', now())::date + make_interval(months => v_i))::date;
    PERFORM public.create_transaction_month_partition(v_month);
  END LOOP;
END;
$$;

SELECT public.ensure_future_transaction_partitions(24);

DO $$
DECLARE
  v_partition record;
  v_index_name text;
BEGIN
  FOR v_partition IN
    SELECT ns.nspname AS schema_name, c.relname AS table_name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE i.inhparent = 'public.transactions'::regclass
  LOOP
    v_index_name := format('idx_%s_org_booking', v_partition.table_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (organization_id, booking_date DESC)',
      v_index_name,
      v_partition.schema_name,
      v_partition.table_name
    );

    v_index_name := format('idx_%s_org_account_booking', v_partition.table_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (organization_id, bank_account_id, booking_date DESC)',
      v_index_name,
      v_partition.schema_name,
      v_partition.table_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_partition record;
BEGIN
  FOR v_partition IN
    SELECT ns.nspname AS schema_name, c.relname AS table_name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE i.inhparent = 'public.transactions'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_partition.schema_name, v_partition.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', v_partition.schema_name, v_partition.table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'service_role_all', v_partition.schema_name, v_partition.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'org_member_select', v_partition.schema_name, v_partition.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'org_member_insert', v_partition.schema_name, v_partition.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'org_member_update', v_partition.schema_name, v_partition.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 'org_member_delete', v_partition.schema_name, v_partition.table_name);

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      'service_role_all',
      v_partition.schema_name,
      v_partition.table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR SELECT USING (public.is_org_member(auth.uid(), organization_id))',
      'org_member_select',
      v_partition.schema_name,
      v_partition.table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR INSERT WITH CHECK (public.is_org_member(auth.uid(), organization_id))',
      'org_member_insert',
      v_partition.schema_name,
      v_partition.table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR UPDATE USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id))',
      'org_member_update',
      v_partition.schema_name,
      v_partition.table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR DELETE USING (public.is_org_member(auth.uid(), organization_id))',
      'org_member_delete',
      v_partition.schema_name,
      v_partition.table_name
    );
  END LOOP;
END;
$$;

COMMIT;
