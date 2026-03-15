BEGIN;

-- Fix: payments_integrity_before_write() declared v_account_currency as
-- public.currency_code (char(3)). PostgreSQL initializes char(n) PL/pgSQL
-- variables to spaces ('   '), which fails the validate_currency CHECK.
-- Fix: use text for the local variable instead.

CREATE OR REPLACE FUNCTION public.payments_integrity_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_currency text;
  v_workflow_active boolean;
BEGIN
  SELECT ba.currency_code::text
    INTO v_account_currency
  FROM public.bank_accounts ba
  WHERE ba.id = NEW.source_account_id
    AND ba.organization_id = NEW.organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid source account % for organization %', NEW.source_account_id, NEW.organization_id
      USING ERRCODE = '23503';
  END IF;

  IF v_account_currency <> NEW.currency_code::text THEN
    RAISE EXCEPTION 'Payment currency % must match source account currency %', NEW.currency_code, v_account_currency
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('pending_approval', 'approved', 'rejected') AND NEW.approval_workflow_id IS NULL THEN
    RAISE EXCEPTION 'approval_workflow_id is required when payment is in approval lifecycle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.approval_workflow_id IS NOT NULL THEN
    SELECT aw.is_active
      INTO v_workflow_active
    FROM public.approval_workflows aw
    WHERE aw.id = NEW.approval_workflow_id
      AND aw.organization_id = NEW.organization_id
      AND aw.effective_from <= now()
      AND (aw.effective_to IS NULL OR aw.effective_to > now());

    IF v_workflow_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'approval_workflow_id % is stale or inactive', NEW.approval_workflow_id
        USING ERRCODE = '23514';
    END IF;
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
    ELSIF OLD.status = 'failed' AND NEW.status NOT IN ('failed', 'pending_approval') THEN
      RAISE EXCEPTION 'Invalid payment status transition from failed to %', NEW.status
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

COMMIT;
