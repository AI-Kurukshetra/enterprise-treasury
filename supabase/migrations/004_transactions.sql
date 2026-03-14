BEGIN;

CREATE TABLE IF NOT EXISTS public.transaction_dedupe_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dedupe_hash text NOT NULL CHECK (length(trim(dedupe_hash)) > 0),
  transaction_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, dedupe_hash),
  UNIQUE (transaction_id),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.transaction_source_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_system text NOT NULL CHECK (length(trim(source_system)) > 0),
  source_event_id text NOT NULL CHECK (length(trim(source_event_id)) > 0),
  transaction_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_system, source_event_id),
  UNIQUE (transaction_id),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  counterparty_id uuid,
  ingestion_job_id uuid,
  source_type public.transaction_source_enum NOT NULL,
  source_system text NOT NULL DEFAULT 'bank',
  source_event_id text,
  event_sequence bigint,
  event_timestamp timestamptz NOT NULL DEFAULT now(),
  external_transaction_id text,
  booking_date date NOT NULL,
  value_date date,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  currency_code public.currency_code NOT NULL,
  direction public.transaction_direction_enum NOT NULL,
  description text,
  category text,
  reconciliation_status public.transaction_reconciliation_status_enum NOT NULL DEFAULT 'unreconciled',
  dedupe_hash text NOT NULL CHECK (length(trim(dedupe_hash)) > 0),
  running_balance numeric(20,6),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactions_pkey PRIMARY KEY (id, booking_date),
  CONSTRAINT fk_transactions_org
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_transactions_account_org
    FOREIGN KEY (bank_account_id, organization_id)
    REFERENCES public.bank_accounts(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_counterparty_org
    FOREIGN KEY (counterparty_id, organization_id)
    REFERENCES public.counterparties(id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_transactions_ingestion_job_org
    FOREIGN KEY (ingestion_job_id, organization_id)
    REFERENCES public.bank_statement_import_jobs(id, organization_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_transactions_value_date
    CHECK (value_date IS NULL OR value_date >= booking_date),
  CONSTRAINT chk_transactions_source_event_not_blank
    CHECK (source_event_id IS NULL OR length(trim(source_event_id)) > 0),
  CONSTRAINT chk_transactions_event_sequence_positive
    CHECK (event_sequence IS NULL OR event_sequence > 0)
) PARTITION BY RANGE (booking_date);

DO $$
DECLARE
  v_partition_start date := DATE '2024-01-01';
  v_partition_end date := DATE '2031-01-01';
  v_month date;
BEGIN
  v_month := v_partition_start;
  WHILE v_month < v_partition_end LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS public.transactions_%s PARTITION OF public.transactions FOR VALUES FROM (%L) TO (%L)',
      to_char(v_month, 'YYYY_MM'),
      v_month,
      (v_month + INTERVAL '1 month')::date
    );
    v_month := (v_month + INTERVAL '1 month')::date;
  END LOOP;

  EXECUTE 'CREATE TABLE IF NOT EXISTS public.transactions_default PARTITION OF public.transactions DEFAULT';
END;
$$;

CREATE INDEX IF NOT EXISTS idx_transactions_org_booking_date
  ON public.transactions (organization_id, booking_date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_org_account_booking_date
  ON public.transactions (organization_id, bank_account_id, booking_date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_org_event_timestamp
  ON public.transactions (organization_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_org_reconciliation_status
  ON public.transactions (organization_id, reconciliation_status);

CREATE INDEX IF NOT EXISTS idx_transactions_org_source_type
  ON public.transactions (organization_id, source_type);

CREATE INDEX IF NOT EXISTS idx_transactions_org_created_at
  ON public.transactions (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_dedupe_org_created
  ON public.transaction_dedupe_keys (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_source_events_org_created
  ON public.transaction_source_events (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.transactions_integrity_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_currency public.currency_code;
  v_max_sequence bigint;
  v_existing_transaction_id uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  NEW.source_system := lower(trim(COALESCE(NEW.source_system, 'bank')));

  IF NEW.source_event_id IS NOT NULL AND length(trim(NEW.source_event_id)) = 0 THEN
    NEW.source_event_id := NULL;
  END IF;

  SELECT ba.currency_code
    INTO v_account_currency
  FROM public.bank_accounts ba
  WHERE ba.id = NEW.bank_account_id
    AND ba.organization_id = NEW.organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account % is not valid for organization %', NEW.bank_account_id, NEW.organization_id
      USING ERRCODE = '23503';
  END IF;

  IF v_account_currency <> NEW.currency_code THEN
    RAISE EXCEPTION 'Transaction currency % does not match bank account currency %', NEW.currency_code, v_account_currency
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_existing_transaction_id := OLD.id;

    IF NEW.organization_id <> OLD.organization_id
       OR NEW.bank_account_id <> OLD.bank_account_id
       OR NEW.booking_date <> OLD.booking_date
       OR NEW.amount <> OLD.amount
       OR NEW.currency_code <> OLD.currency_code
       OR NEW.direction <> OLD.direction
       OR NEW.dedupe_hash <> OLD.dedupe_hash THEN
      RAISE EXCEPTION 'Immutable transaction fields cannot be modified'
        USING ERRCODE = '22000';
    END IF;
  ELSE
    INSERT INTO public.transaction_dedupe_keys (organization_id, dedupe_hash, transaction_id)
    VALUES (NEW.organization_id, NEW.dedupe_hash, NEW.id)
    ON CONFLICT (organization_id, dedupe_hash) DO NOTHING;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Duplicate transaction import detected for dedupe_hash %', NEW.dedupe_hash
        USING ERRCODE = '23505';
    END IF;

    IF NEW.source_event_id IS NOT NULL THEN
      INSERT INTO public.transaction_source_events (organization_id, source_system, source_event_id, transaction_id)
      VALUES (NEW.organization_id, NEW.source_system, NEW.source_event_id, NEW.id)
      ON CONFLICT (organization_id, source_system, source_event_id) DO NOTHING;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Replayed source event detected: % / %', NEW.source_system, NEW.source_event_id
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  IF NEW.event_sequence IS NOT NULL THEN
    SELECT max(t.event_sequence)
      INTO v_max_sequence
    FROM public.transactions t
    WHERE t.organization_id = NEW.organization_id
      AND t.bank_account_id = NEW.bank_account_id
      AND t.source_system = NEW.source_system
      AND (v_existing_transaction_id IS NULL OR t.id <> v_existing_transaction_id);

    IF v_max_sequence IS NOT NULL AND NEW.event_sequence <= v_max_sequence THEN
      RAISE EXCEPTION 'Out-of-order event sequence % (latest is %)', NEW.event_sequence, v_max_sequence
        USING ERRCODE = '22000';
    END IF;
  ELSIF NEW.source_type = 'bank_import' THEN
    RAISE EXCEPTION 'event_sequence is required for bank_import transactions'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_integrity_before_write ON public.transactions;
CREATE TRIGGER trg_transactions_integrity_before_write
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.transactions_integrity_before_write();

DROP TRIGGER IF EXISTS trg_transaction_dedupe_keys_set_updated_at ON public.transaction_dedupe_keys;
CREATE TRIGGER trg_transaction_dedupe_keys_set_updated_at
BEFORE UPDATE ON public.transaction_dedupe_keys
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_transaction_source_events_set_updated_at ON public.transaction_source_events;
CREATE TRIGGER trg_transaction_source_events_set_updated_at
BEFORE UPDATE ON public.transaction_source_events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
