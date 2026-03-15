BEGIN;

-- Fix: transactions_integrity_before_write() declared v_account_currency as
-- public.currency_code (char(3)). PostgreSQL initializes char(n) PL/pgSQL
-- variables to spaces ('   '), which fails the validate_currency CHECK.
-- Fix: use text for the local variable instead.

CREATE OR REPLACE FUNCTION public.transactions_integrity_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_currency text;
BEGIN
  SELECT ba.currency_code::text
    INTO v_account_currency
  FROM public.bank_accounts ba
  WHERE ba.id = NEW.bank_account_id
    AND ba.organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account % not found for organization %', NEW.bank_account_id, NEW.organization_id
      USING ERRCODE = '23503';
  END IF;

  IF v_account_currency <> NEW.currency_code::text THEN
    RAISE EXCEPTION 'Transaction currency % does not match bank account currency %', NEW.currency_code, v_account_currency
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id <> OLD.organization_id
       OR NEW.bank_account_id <> OLD.bank_account_id
       OR NEW.booking_date <> OLD.booking_date
       OR NEW.currency_code <> OLD.currency_code THEN
      RAISE EXCEPTION 'Immutable transaction fields cannot be modified'
        USING ERRCODE = '22000';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMIT;
