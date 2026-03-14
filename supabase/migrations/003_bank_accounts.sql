BEGIN;

CREATE TABLE IF NOT EXISTS public.bank_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (length(trim(provider)) > 0),
  connection_type public.bank_connection_type_enum NOT NULL,
  status public.bank_connection_status_enum NOT NULL DEFAULT 'active',
  last_sync_at timestamptz,
  config_encrypted jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_connection_id uuid,
  account_name text NOT NULL CHECK (length(trim(account_name)) > 0),
  account_number_masked text NOT NULL CHECK (length(trim(account_number_masked)) > 0),
  iban text,
  swift_bic text,
  currency_code public.currency_code NOT NULL,
  country_code char(2),
  status public.bank_account_status_enum NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_bank_accounts_connection_org
    FOREIGN KEY (bank_connection_id, organization_id)
    REFERENCES public.bank_connections (id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_bank_accounts_country_code
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.counterparties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  type public.counterparty_type_enum NOT NULL,
  country_code char(2),
  risk_rating text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_counterparties_country_code
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.bank_statement_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_connection_id uuid NOT NULL,
  status public.import_job_status_enum NOT NULL DEFAULT 'queued',
  source_filename text,
  started_at timestamptz,
  completed_at timestamptz,
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  processed_rows integer NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  failed_rows integer NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  error_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_bank_jobs_connection_org
    FOREIGN KEY (bank_connection_id, organization_id)
    REFERENCES public.bank_connections (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT chk_bank_jobs_completed_after_started
    CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_connections_org_status
  ON public.bank_connections (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_org_status
  ON public.bank_accounts (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_org_currency
  ON public.bank_accounts (organization_id, currency_code);

CREATE INDEX IF NOT EXISTS idx_counterparties_org_name
  ON public.counterparties (organization_id, name);

CREATE INDEX IF NOT EXISTS idx_bank_jobs_org_status_created
  ON public.bank_statement_import_jobs (organization_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_bank_connections_set_updated_at ON public.bank_connections;
CREATE TRIGGER trg_bank_connections_set_updated_at
BEFORE UPDATE ON public.bank_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_bank_accounts_set_updated_at ON public.bank_accounts;
CREATE TRIGGER trg_bank_accounts_set_updated_at
BEFORE UPDATE ON public.bank_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_counterparties_set_updated_at ON public.counterparties;
CREATE TRIGGER trg_counterparties_set_updated_at
BEFORE UPDATE ON public.counterparties
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_bank_jobs_set_updated_at ON public.bank_statement_import_jobs;
CREATE TRIGGER trg_bank_jobs_set_updated_at
BEFORE UPDATE ON public.bank_statement_import_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
