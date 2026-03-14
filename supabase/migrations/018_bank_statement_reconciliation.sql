BEGIN;

ALTER TABLE public.bank_statement_import_jobs
  ADD COLUMN IF NOT EXISTS bank_account_id uuid,
  ADD COLUMN IF NOT EXISTS format text,
  ADD COLUMN IF NOT EXISTS detected_account_identifier text,
  ADD COLUMN IF NOT EXISTS total_records integer NOT NULL DEFAULT 0 CHECK (total_records >= 0),
  ADD COLUMN IF NOT EXISTS imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  ADD COLUMN IF NOT EXISTS duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  ADD COLUMN IF NOT EXISTS error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  ADD COLUMN IF NOT EXISTS warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  ADD COLUMN IF NOT EXISTS result_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_bank_jobs_account_org'
      AND conrelid = 'public.bank_statement_import_jobs'::regclass
  ) THEN
    ALTER TABLE public.bank_statement_import_jobs
      ADD CONSTRAINT fk_bank_jobs_account_org
      FOREIGN KEY (bank_account_id, organization_id)
      REFERENCES public.bank_accounts (id, organization_id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_bank_jobs_org_account_created
  ON public.bank_statement_import_jobs (organization_id, bank_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.expected_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL,
  counterparty_id uuid,
  receipt_reference text NOT NULL CHECK (length(trim(receipt_reference)) > 0),
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  currency_code public.currency_code NOT NULL,
  expected_value_date date NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN ('open', 'partially_reconciled', 'reconciled', 'cancelled')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, receipt_reference),
  UNIQUE (id, organization_id),
  CONSTRAINT fk_expected_receipts_account_org
    FOREIGN KEY (bank_account_id, organization_id)
    REFERENCES public.bank_accounts (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_expected_receipts_counterparty_org
    FOREIGN KEY (counterparty_id, organization_id)
    REFERENCES public.counterparties (id, organization_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_expected_receipts_org_status_value_date
  ON public.expected_receipts (organization_id, status, expected_value_date);

CREATE TABLE IF NOT EXISTS public.transaction_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL,
  transaction_booking_date date NOT NULL,
  payment_id uuid,
  expected_receipt_id uuid,
  match_type text NOT NULL CHECK (match_type IN ('exact', 'fuzzy', 'exception')),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, match_type),
  UNIQUE (id, organization_id),
  CONSTRAINT fk_transaction_reconciliations_transaction
    FOREIGN KEY (transaction_id, transaction_booking_date)
    REFERENCES public.transactions (id, booking_date)
    ON DELETE CASCADE,
  CONSTRAINT fk_transaction_reconciliations_payment_org
    FOREIGN KEY (payment_id, organization_id)
    REFERENCES public.payments (id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_transaction_reconciliations_receipt_org
    FOREIGN KEY (expected_receipt_id, organization_id)
    REFERENCES public.expected_receipts (id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_transaction_reconciliation_target
    CHECK (
      (match_type = 'exception' AND payment_id IS NULL AND expected_receipt_id IS NULL)
      OR (match_type IN ('exact', 'fuzzy') AND ((payment_id IS NOT NULL) <> (expected_receipt_id IS NOT NULL)))
    )
);

CREATE INDEX IF NOT EXISTS idx_transaction_reconciliations_org_created
  ON public.transaction_reconciliations (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_reconciliations_org_payment
  ON public.transaction_reconciliations (organization_id, payment_id)
  WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transaction_reconciliations_org_receipt
  ON public.transaction_reconciliations (organization_id, expected_receipt_id)
  WHERE expected_receipt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (length(trim(type)) > 0),
  message text NOT NULL CHECK (length(trim(message)) > 0),
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_org_created
  ON public.notifications (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_org_unread
  ON public.notifications (organization_id, read_at, created_at DESC);

DROP TRIGGER IF EXISTS trg_expected_receipts_set_updated_at ON public.expected_receipts;
CREATE TRIGGER trg_expected_receipts_set_updated_at
BEFORE UPDATE ON public.expected_receipts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_transaction_reconciliations_set_updated_at ON public.transaction_reconciliations;
CREATE TRIGGER trg_transaction_reconciliations_set_updated_at
BEFORE UPDATE ON public.transaction_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_notifications_set_updated_at ON public.notifications;
CREATE TRIGGER trg_notifications_set_updated_at
BEFORE UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.expected_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expected_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_reconciliations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON public.expected_receipts;
DROP POLICY IF EXISTS org_member_select ON public.expected_receipts;
DROP POLICY IF EXISTS org_member_insert ON public.expected_receipts;
DROP POLICY IF EXISTS org_member_update ON public.expected_receipts;
DROP POLICY IF EXISTS org_member_delete ON public.expected_receipts;

CREATE POLICY service_role_all ON public.expected_receipts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY org_member_select ON public.expected_receipts
  FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_insert ON public.expected_receipts
  FOR INSERT
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_update ON public.expected_receipts
  FOR UPDATE
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_delete ON public.expected_receipts
  FOR DELETE
  USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS service_role_all ON public.transaction_reconciliations;
DROP POLICY IF EXISTS org_member_select ON public.transaction_reconciliations;
DROP POLICY IF EXISTS org_member_insert ON public.transaction_reconciliations;
DROP POLICY IF EXISTS org_member_update ON public.transaction_reconciliations;
DROP POLICY IF EXISTS org_member_delete ON public.transaction_reconciliations;

CREATE POLICY service_role_all ON public.transaction_reconciliations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY org_member_select ON public.transaction_reconciliations
  FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_insert ON public.transaction_reconciliations
  FOR INSERT
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_update ON public.transaction_reconciliations
  FOR UPDATE
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_delete ON public.transaction_reconciliations
  FOR DELETE
  USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS service_role_all ON public.notifications;
DROP POLICY IF EXISTS org_member_select ON public.notifications;
DROP POLICY IF EXISTS org_member_insert ON public.notifications;
DROP POLICY IF EXISTS org_member_update ON public.notifications;
DROP POLICY IF EXISTS org_member_delete ON public.notifications;

CREATE POLICY service_role_all ON public.notifications
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY org_member_select ON public.notifications
  FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_insert ON public.notifications
  FOR INSERT
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_update ON public.notifications
  FOR UPDATE
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_delete ON public.notifications
  FOR DELETE
  USING (public.is_org_member(auth.uid(), organization_id));

DROP TRIGGER IF EXISTS trg_audit_expected_receipts ON public.expected_receipts;
CREATE TRIGGER trg_audit_expected_receipts
AFTER INSERT OR UPDATE OR DELETE ON public.expected_receipts
FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log_from_row();

DROP TRIGGER IF EXISTS trg_audit_transaction_reconciliations ON public.transaction_reconciliations;
CREATE TRIGGER trg_audit_transaction_reconciliations
AFTER INSERT OR UPDATE OR DELETE ON public.transaction_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log_from_row();

DROP TRIGGER IF EXISTS trg_audit_notifications ON public.notifications;
CREATE TRIGGER trg_audit_notifications
AFTER INSERT OR UPDATE OR DELETE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log_from_row();

COMMIT;
