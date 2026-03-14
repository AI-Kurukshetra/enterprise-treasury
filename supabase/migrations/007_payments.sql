BEGIN;

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (length(trim(operation)) > 0),
  idempotency_key text NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  request_hash text NOT NULL CHECK (length(trim(request_hash)) > 0),
  response_snapshot jsonb,
  status public.idempotency_status_enum NOT NULL DEFAULT 'in_progress',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, operation, idempotency_key),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_reference text NOT NULL CHECK (length(trim(payment_reference)) > 0),
  source_account_id uuid NOT NULL,
  beneficiary_counterparty_id uuid NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  currency_code public.currency_code NOT NULL,
  value_date date NOT NULL,
  purpose text,
  status public.payment_status_enum NOT NULL DEFAULT 'draft',
  idempotency_key text NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  request_id text,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approval_workflow_id uuid,
  approved_at timestamptz,
  executed_at timestamptz,
  failure_reason text,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_payments_source_account_org
    FOREIGN KEY (source_account_id, organization_id)
    REFERENCES public.bank_accounts (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_payments_beneficiary_org
    FOREIGN KEY (beneficiary_counterparty_id, organization_id)
    REFERENCES public.counterparties (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_payments_version_positive CHECK (version > 0),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, payment_reference),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_org_operation
  ON public.idempotency_keys (organization_id, operation, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_org_status_created
  ON public.payments (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_org_value_date
  ON public.payments (organization_id, value_date);

CREATE INDEX IF NOT EXISTS idx_payments_org_source_account
  ON public.payments (organization_id, source_account_id);

CREATE OR REPLACE FUNCTION public.payments_integrity_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_currency public.currency_code;
BEGIN
  SELECT ba.currency_code
    INTO v_account_currency
  FROM public.bank_accounts ba
  WHERE ba.id = NEW.source_account_id
    AND ba.organization_id = NEW.organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid source account % for organization %', NEW.source_account_id, NEW.organization_id
      USING ERRCODE = '23503';
  END IF;

  IF v_account_currency <> NEW.currency_code THEN
    RAISE EXCEPTION 'Payment currency % must match source account currency %', NEW.currency_code, v_account_currency
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id <> OLD.organization_id
       OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.created_by <> OLD.created_by THEN
      RAISE EXCEPTION 'Immutable payment fields cannot be modified'
        USING ERRCODE = '22000';
    END IF;

    IF NEW.version <> OLD.version THEN
      RAISE EXCEPTION 'Version is managed by trigger and optimistic lock checks'
        USING ERRCODE = '22000';
    END IF;

    IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'pending_approval', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid payment status transition from draft to %', NEW.status
        USING ERRCODE = '22000';
    ELSIF OLD.status = 'pending_approval' AND NEW.status NOT IN ('pending_approval', 'approved', 'rejected', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid payment status transition from pending_approval to %', NEW.status
        USING ERRCODE = '22000';
    ELSIF OLD.status = 'approved' AND NEW.status NOT IN ('approved', 'sent', 'cancelled') THEN
      RAISE EXCEPTION 'Invalid payment status transition from approved to %', NEW.status
        USING ERRCODE = '22000';
    ELSIF OLD.status = 'sent' AND NEW.status NOT IN ('sent', 'settled', 'failed') THEN
      RAISE EXCEPTION 'Invalid payment status transition from sent to %', NEW.status
        USING ERRCODE = '22000';
    ELSIF OLD.status IN ('rejected', 'cancelled', 'settled') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'Terminal payment status % cannot transition', OLD.status
        USING ERRCODE = '22000';
    END IF;

    NEW.version := OLD.version + 1;
  END IF;

  IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
    NEW.approved_at := now();
  END IF;

  IF NEW.status IN ('sent', 'settled') AND NEW.executed_at IS NULL THEN
    NEW.executed_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_idempotency_keys_set_updated_at ON public.idempotency_keys;
CREATE TRIGGER trg_idempotency_keys_set_updated_at
BEFORE UPDATE ON public.idempotency_keys
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_payments_integrity_before_write ON public.payments;
CREATE TRIGGER trg_payments_integrity_before_write
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.payments_integrity_before_write();

COMMIT;
