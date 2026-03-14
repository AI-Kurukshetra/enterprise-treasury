BEGIN;

CREATE TABLE IF NOT EXISTS public.debt_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  facility_name text NOT NULL CHECK (length(trim(facility_name)) > 0),
  facility_type public.debt_facility_type_enum NOT NULL,
  lender_counterparty_id uuid,
  limit_amount numeric(20,6) NOT NULL CHECK (limit_amount > 0),
  utilized_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (utilized_amount >= 0),
  currency_code public.currency_code NOT NULL,
  interest_basis text,
  covenant_summary jsonb,
  status public.debt_status_enum NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_debt_facilities_lender_org
    FOREIGN KEY (lender_counterparty_id, organization_id)
    REFERENCES public.counterparties (id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_debt_facilities_utilization
    CHECK (utilized_amount <= limit_amount),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.debt_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  debt_facility_id uuid NOT NULL,
  due_date date NOT NULL,
  principal_due numeric(20,6) NOT NULL DEFAULT 0 CHECK (principal_due >= 0),
  interest_due numeric(20,6) NOT NULL DEFAULT 0 CHECK (interest_due >= 0),
  status public.debt_schedule_status_enum NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_debt_schedules_facility_org
    FOREIGN KEY (debt_facility_id, organization_id)
    REFERENCES public.debt_facilities (id, organization_id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, debt_facility_id, due_date),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_debt_facilities_org_status
  ON public.debt_facilities (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_debt_schedules_org_due_date
  ON public.debt_schedules (organization_id, due_date);

CREATE INDEX IF NOT EXISTS idx_debt_schedules_org_status_due
  ON public.debt_schedules (organization_id, status, due_date);

DROP TRIGGER IF EXISTS trg_debt_facilities_set_updated_at ON public.debt_facilities;
CREATE TRIGGER trg_debt_facilities_set_updated_at
BEFORE UPDATE ON public.debt_facilities
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_debt_schedules_set_updated_at ON public.debt_schedules;
CREATE TRIGGER trg_debt_schedules_set_updated_at
BEFORE UPDATE ON public.debt_schedules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
