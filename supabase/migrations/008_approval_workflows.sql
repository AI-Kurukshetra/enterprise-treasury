BEGIN;

CREATE TABLE IF NOT EXISTS public.approval_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  domain public.approval_domain_enum NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_approval_workflows_effective_window
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (organization_id, domain, name, version),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL,
  step_order integer NOT NULL CHECK (step_order > 0),
  role_id uuid NOT NULL,
  min_approvals integer NOT NULL DEFAULT 1 CHECK (min_approvals > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_approval_steps_workflow_org
    FOREIGN KEY (workflow_id, organization_id)
    REFERENCES public.approval_workflows (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_approval_steps_role_org
    FOREIGN KEY (role_id, organization_id)
    REFERENCES public.roles (id, organization_id)
    ON DELETE RESTRICT,
  UNIQUE (workflow_id, step_order),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.payment_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL,
  approval_step_id uuid NOT NULL,
  approver_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  decision public.approval_decision_enum NOT NULL,
  comment text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_payment_approvals_payment_org
    FOREIGN KEY (payment_id, organization_id)
    REFERENCES public.payments (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_payment_approvals_step_org
    FOREIGN KEY (approval_step_id, organization_id)
    REFERENCES public.approval_steps (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_payment_approval_tuple
    UNIQUE (payment_id, approval_step_id, approver_user_id),
  UNIQUE (id, organization_id)
);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS approval_workflow_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_payments_approval_workflow_org'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT fk_payments_approval_workflow_org
      FOREIGN KEY (approval_workflow_id, organization_id)
      REFERENCES public.approval_workflows (id, organization_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_approval_workflows_org_domain_active
  ON public.approval_workflows (organization_id, domain, is_active, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_approval_steps_org_workflow_order
  ON public.approval_steps (organization_id, workflow_id, step_order);

CREATE INDEX IF NOT EXISTS idx_payment_approvals_org_payment
  ON public.payment_approvals (organization_id, payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_approvals_org_approver
  ON public.payment_approvals (organization_id, approver_user_id, decided_at DESC);

CREATE OR REPLACE FUNCTION public.payments_integrity_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_currency public.currency_code;
  v_workflow_active boolean;
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

CREATE OR REPLACE FUNCTION public.prevent_stale_workflow_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_pending_count bigint;
BEGIN
  IF (NEW.is_active = false AND OLD.is_active = true)
      OR (NEW.effective_to IS NOT NULL AND (OLD.effective_to IS NULL OR NEW.effective_to <> OLD.effective_to)) THEN
    SELECT count(*)
      INTO v_pending_count
    FROM public.payments p
    WHERE p.organization_id = NEW.organization_id
      AND p.approval_workflow_id = NEW.id
      AND p.status = 'pending_approval';

    IF v_pending_count > 0 THEN
      RAISE EXCEPTION 'Cannot deactivate or expire workflow % with pending approvals', NEW.id
        USING ERRCODE = '22000';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.payment_approvals_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_step_workflow_id uuid;
BEGIN
  NEW.decided_at := COALESCE(NEW.decided_at, now());

  SELECT *
    INTO v_payment
  FROM public.payments p
  WHERE p.id = NEW.payment_id
    AND p.organization_id = NEW.organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % does not exist for organization %', NEW.payment_id, NEW.organization_id
      USING ERRCODE = '23503';
  END IF;

  IF v_payment.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Payment % is not pending approval', NEW.payment_id
      USING ERRCODE = '22000';
  END IF;

  SELECT s.workflow_id
    INTO v_step_workflow_id
  FROM public.approval_steps s
  WHERE s.id = NEW.approval_step_id
    AND s.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval step % not found', NEW.approval_step_id
      USING ERRCODE = '23503';
  END IF;

  IF v_payment.approval_workflow_id IS DISTINCT FROM v_step_workflow_id THEN
    RAISE EXCEPTION 'Approval step % does not belong to payment workflow %', NEW.approval_step_id, v_payment.approval_workflow_id
      USING ERRCODE = '22000';
  END IF;

  IF NOT public.is_org_member(NEW.approver_user_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'Approver % is not an active member of organization %', NEW.approver_user_id, NEW.organization_id
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_payment_approval_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_has_rejection boolean;
  v_all_steps_complete boolean := true;
  v_step record;
  v_approved_count bigint;
BEGIN
  SELECT *
    INTO v_payment
  FROM public.payments p
  WHERE p.id = NEW.payment_id
    AND p.organization_id = NEW.organization_id
  FOR UPDATE;

  IF NOT FOUND OR v_payment.status <> 'pending_approval' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.payment_approvals pa
    WHERE pa.organization_id = NEW.organization_id
      AND pa.payment_id = NEW.payment_id
      AND pa.decision = 'rejected'
  ) INTO v_has_rejection;

  IF v_has_rejection THEN
    UPDATE public.payments p
       SET status = 'rejected'
     WHERE p.id = NEW.payment_id
       AND p.organization_id = NEW.organization_id
       AND p.status = 'pending_approval';
    RETURN NEW;
  END IF;

  FOR v_step IN
    SELECT s.id, s.min_approvals
    FROM public.approval_steps s
    WHERE s.organization_id = NEW.organization_id
      AND s.workflow_id = v_payment.approval_workflow_id
    ORDER BY s.step_order
  LOOP
    SELECT count(*)
      INTO v_approved_count
    FROM public.payment_approvals pa
    WHERE pa.organization_id = NEW.organization_id
      AND pa.payment_id = NEW.payment_id
      AND pa.approval_step_id = v_step.id
      AND pa.decision = 'approved';

    IF v_approved_count < v_step.min_approvals THEN
      v_all_steps_complete := false;
      EXIT;
    END IF;
  END LOOP;

  IF v_all_steps_complete THEN
    UPDATE public.payments p
       SET status = 'approved'
     WHERE p.id = NEW.payment_id
       AND p.organization_id = NEW.organization_id
       AND p.status = 'pending_approval';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_workflows_set_updated_at ON public.approval_workflows;
CREATE TRIGGER trg_approval_workflows_set_updated_at
BEFORE UPDATE ON public.approval_workflows
FOR EACH ROW EXECUTE FUNCTION public.prevent_stale_workflow_update();

DROP TRIGGER IF EXISTS trg_approval_steps_set_updated_at ON public.approval_steps;
CREATE TRIGGER trg_approval_steps_set_updated_at
BEFORE UPDATE ON public.approval_steps
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_payment_approvals_set_updated_at ON public.payment_approvals;
CREATE TRIGGER trg_payment_approvals_set_updated_at
BEFORE UPDATE ON public.payment_approvals
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_payment_approvals_before_insert ON public.payment_approvals;
CREATE TRIGGER trg_payment_approvals_before_insert
BEFORE INSERT ON public.payment_approvals
FOR EACH ROW EXECUTE FUNCTION public.payment_approvals_before_insert();

DROP TRIGGER IF EXISTS trg_payment_approvals_after_insert ON public.payment_approvals;
CREATE TRIGGER trg_payment_approvals_after_insert
AFTER INSERT ON public.payment_approvals
FOR EACH ROW EXECUTE FUNCTION public.apply_payment_approval_decision();

DROP TRIGGER IF EXISTS trg_payments_integrity_before_write ON public.payments;
CREATE TRIGGER trg_payments_integrity_before_write
BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.payments_integrity_before_write();

COMMIT;
