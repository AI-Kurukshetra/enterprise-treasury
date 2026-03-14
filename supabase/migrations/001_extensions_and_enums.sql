BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.validate_currency(p_currency text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_currency IS NULL
     OR upper(trim(p_currency)) ~ '^[A-Z]{3}$';
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'currency_code'
  ) THEN
    CREATE DOMAIN public.currency_code AS char(3)
      CHECK (public.validate_currency(VALUE));
  END IF;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'organization_status_enum') THEN
    CREATE TYPE public.organization_status_enum AS ENUM ('active', 'suspended', 'archived');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_status_enum') THEN
    CREATE TYPE public.membership_status_enum AS ENUM ('invited', 'active', 'revoked');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bank_connection_type_enum') THEN
    CREATE TYPE public.bank_connection_type_enum AS ENUM ('open_banking', 'sftp', 'manual_file');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bank_connection_status_enum') THEN
    CREATE TYPE public.bank_connection_status_enum AS ENUM ('active', 'degraded', 'disconnected');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bank_account_status_enum') THEN
    CREATE TYPE public.bank_account_status_enum AS ENUM ('active', 'dormant', 'closed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'counterparty_type_enum') THEN
    CREATE TYPE public.counterparty_type_enum AS ENUM ('customer', 'vendor', 'bank', 'affiliate', 'other');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_job_status_enum') THEN
    CREATE TYPE public.import_job_status_enum AS ENUM ('queued', 'running', 'partial', 'completed', 'failed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_direction_enum') THEN
    CREATE TYPE public.transaction_direction_enum AS ENUM ('inflow', 'outflow');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_source_enum') THEN
    CREATE TYPE public.transaction_source_enum AS ENUM ('bank_import', 'manual_adjustment', 'payment_settlement', 'fx_conversion');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_reconciliation_status_enum') THEN
    CREATE TYPE public.transaction_reconciliation_status_enum AS ENUM ('unreconciled', 'partially_reconciled', 'reconciled', 'exception');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_scope_type_enum') THEN
    CREATE TYPE public.cash_scope_type_enum AS ENUM ('account', 'entity', 'organization');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forecast_type_enum') THEN
    CREATE TYPE public.forecast_type_enum AS ENUM ('short_term', 'long_term');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forecast_model_type_enum') THEN
    CREATE TYPE public.forecast_model_type_enum AS ENUM ('statistical', 'ai_hybrid');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forecast_status_enum') THEN
    CREATE TYPE public.forecast_status_enum AS ENUM ('draft', 'published', 'superseded');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum') THEN
    CREATE TYPE public.payment_status_enum AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'sent', 'settled', 'failed', 'cancelled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_domain_enum') THEN
    CREATE TYPE public.approval_domain_enum AS ENUM ('payments', 'policy_change', 'connector_change');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_decision_enum') THEN
    CREATE TYPE public.approval_decision_enum AS ENUM ('approved', 'rejected');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'idempotency_status_enum') THEN
    CREATE TYPE public.idempotency_status_enum AS ENUM ('in_progress', 'completed', 'failed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'liquidity_pool_type_enum') THEN
    CREATE TYPE public.liquidity_pool_type_enum AS ENUM ('physical', 'notional');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sweep_frequency_enum') THEN
    CREATE TYPE public.sweep_frequency_enum AS ENUM ('daily', 'weekly', 'monthly');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'intercompany_status_enum') THEN
    CREATE TYPE public.intercompany_status_enum AS ENUM ('proposed', 'active', 'settled', 'cancelled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_type_enum') THEN
    CREATE TYPE public.risk_type_enum AS ENUM ('fx', 'interest_rate', 'credit', 'liquidity');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_status_enum') THEN
    CREATE TYPE public.risk_status_enum AS ENUM ('normal', 'warning', 'breached');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hedging_instrument_type_enum') THEN
    CREATE TYPE public.hedging_instrument_type_enum AS ENUM ('forward', 'option', 'swap');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hedging_status_enum') THEN
    CREATE TYPE public.hedging_status_enum AS ENUM ('draft', 'active', 'matured', 'closed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'investment_type_enum') THEN
    CREATE TYPE public.investment_type_enum AS ENUM ('mmf', 'td', 'bond', 'other');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'investment_status_enum') THEN
    CREATE TYPE public.investment_status_enum AS ENUM ('active', 'matured', 'redeemed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'debt_facility_type_enum') THEN
    CREATE TYPE public.debt_facility_type_enum AS ENUM ('revolver', 'term_loan', 'overdraft');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'debt_status_enum') THEN
    CREATE TYPE public.debt_status_enum AS ENUM ('active', 'suspended', 'closed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'debt_schedule_status_enum') THEN
    CREATE TYPE public.debt_schedule_status_enum AS ENUM ('scheduled', 'paid', 'overdue');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_actor_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_claim text;
BEGIN
  v_claim := COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF((auth.jwt() ->> 'sub'), '')
  );

  IF v_claim IS NULL THEN
    RETURN auth.uid();
  END IF;

  BEGIN
    RETURN v_claim::uuid;
  EXCEPTION WHEN others THEN
    RETURN auth.uid();
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_organization_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_claim text;
BEGIN
  v_claim := COALESCE(
    NULLIF(current_setting('request.jwt.claim.organization_id', true), ''),
    NULLIF((auth.jwt() ->> 'organization_id'), '')
  );

  IF v_claim IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN v_claim::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

COMMIT;
