BEGIN;

CREATE TABLE IF NOT EXISTS public.liquidity_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  base_currency public.currency_code NOT NULL,
  pool_type public.liquidity_pool_type_enum NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.liquidity_pool_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  liquidity_pool_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  priority integer NOT NULL DEFAULT 100 CHECK (priority > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_liquidity_pool_accounts_pool_org
    FOREIGN KEY (liquidity_pool_id, organization_id)
    REFERENCES public.liquidity_pools (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_liquidity_pool_accounts_account_org
    FOREIGN KEY (bank_account_id, organization_id)
    REFERENCES public.bank_accounts (id, organization_id)
    ON DELETE CASCADE,
  UNIQUE (liquidity_pool_id, bank_account_id),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.sweeping_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  liquidity_pool_id uuid NOT NULL,
  source_account_id uuid NOT NULL,
  target_account_id uuid NOT NULL,
  min_balance numeric(20,6) NOT NULL CHECK (min_balance >= 0),
  target_balance numeric(20,6) NOT NULL CHECK (target_balance >= 0),
  frequency public.sweep_frequency_enum NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sweeping_rules_pool_org
    FOREIGN KEY (liquidity_pool_id, organization_id)
    REFERENCES public.liquidity_pools (id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_sweeping_rules_source_org
    FOREIGN KEY (source_account_id, organization_id)
    REFERENCES public.bank_accounts (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_sweeping_rules_target_org
    FOREIGN KEY (target_account_id, organization_id)
    REFERENCES public.bank_accounts (id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT chk_sweeping_rules_source_target_different
    CHECK (source_account_id <> target_account_id),
  CONSTRAINT chk_sweeping_rules_target_gte_min
    CHECK (target_balance >= min_balance),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.intercompany_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lender_entity_id uuid NOT NULL,
  borrower_entity_id uuid NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  currency_code public.currency_code NOT NULL,
  interest_rate numeric(8,4),
  maturity_date date,
  status public.intercompany_status_enum NOT NULL DEFAULT 'proposed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_intercompany_lender_borrower
    CHECK (lender_entity_id <> borrower_entity_id),
  CONSTRAINT chk_intercompany_interest_rate
    CHECK (interest_rate IS NULL OR (interest_rate >= 0 AND interest_rate <= 100)),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_liquidity_pools_org_type
  ON public.liquidity_pools (organization_id, pool_type);

CREATE INDEX IF NOT EXISTS idx_liquidity_pool_accounts_org_pool
  ON public.liquidity_pool_accounts (organization_id, liquidity_pool_id, priority);

CREATE INDEX IF NOT EXISTS idx_sweeping_rules_org_active
  ON public.sweeping_rules (organization_id, is_active, frequency);

CREATE INDEX IF NOT EXISTS idx_intercompany_org_status_created
  ON public.intercompany_transactions (organization_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_liquidity_pools_set_updated_at ON public.liquidity_pools;
CREATE TRIGGER trg_liquidity_pools_set_updated_at
BEFORE UPDATE ON public.liquidity_pools
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_liquidity_pool_accounts_set_updated_at ON public.liquidity_pool_accounts;
CREATE TRIGGER trg_liquidity_pool_accounts_set_updated_at
BEFORE UPDATE ON public.liquidity_pool_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_sweeping_rules_set_updated_at ON public.sweeping_rules;
CREATE TRIGGER trg_sweeping_rules_set_updated_at
BEFORE UPDATE ON public.sweeping_rules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_intercompany_transactions_set_updated_at ON public.intercompany_transactions;
CREATE TRIGGER trg_intercompany_transactions_set_updated_at
BEFORE UPDATE ON public.intercompany_transactions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
