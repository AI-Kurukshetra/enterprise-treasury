\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.organizations (id, name, base_currency, status)
VALUES ('33333333-3333-3333-3333-333333333333', 'Constraint Org', 'USD', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, email)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'constraints-user@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roles (id, organization_id, name, is_system)
VALUES ('cccccccc-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', 'member', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_memberships (id, organization_id, user_id, role_id, status)
VALUES ('cccccccc-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-3333-3333-3333-333333333333', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bank_connections (id, organization_id, provider, connection_type, status)
VALUES ('33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'test-bank', 'manual_file', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bank_accounts (
  id,
  organization_id,
  bank_connection_id,
  account_name,
  account_number_masked,
  currency_code,
  status
)
VALUES (
  '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '33333333-3333-3333-3333-333333333333',
  '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Main USD Account',
  '****1234',
  'USD',
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.counterparties (id, organization_id, name, type)
VALUES ('33333333-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'Vendor A', 'vendor')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bank_statement_import_jobs (
  id,
  organization_id,
  bank_connection_id,
  status,
  total_rows,
  processed_rows,
  failed_rows
)
VALUES (
  '33333333-dddd-dddd-dddd-dddddddddddd',
  '33333333-3333-3333-3333-333333333333',
  '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'completed',
  1,
  1,
  0
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.transactions (
  id,
  organization_id,
  bank_account_id,
  counterparty_id,
  ingestion_job_id,
  source_type,
  source_system,
  source_event_id,
  event_sequence,
  event_timestamp,
  booking_date,
  value_date,
  amount,
  currency_code,
  direction,
  dedupe_hash
)
VALUES (
  '33333333-eeee-eeee-eeee-eeeeeeeeeeee',
  '33333333-3333-3333-3333-333333333333',
  '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '33333333-cccc-cccc-cccc-cccccccccccc',
  '33333333-dddd-dddd-dddd-dddddddddddd',
  'bank_import',
  'bank_csv',
  'event-100',
  100,
  '2026-02-01T12:00:00Z',
  '2026-02-01',
  '2026-02-01',
  10.500000,
  'USD',
  'inflow',
  'dedupe-hash-100'
)
ON CONFLICT (id, booking_date) DO NOTHING;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.transactions (
      id,
      organization_id,
      bank_account_id,
      source_type,
      source_system,
      source_event_id,
      event_sequence,
      event_timestamp,
      booking_date,
      amount,
      currency_code,
      direction,
      dedupe_hash
    )
    VALUES (
      '33333333-ffff-ffff-ffff-ffffffffffff',
      '33333333-3333-3333-3333-333333333333',
      '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'bank_import',
      'bank_csv',
      'event-101',
      101,
      '2026-02-01T13:00:00Z',
      '2026-02-01',
      11.000000,
      'USD',
      'inflow',
      'dedupe-hash-100'
    );
    RAISE EXCEPTION 'Expected duplicate dedupe_hash violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.transactions (
      id,
      organization_id,
      bank_account_id,
      source_type,
      source_system,
      source_event_id,
      event_sequence,
      event_timestamp,
      booking_date,
      amount,
      currency_code,
      direction,
      dedupe_hash
    )
    VALUES (
      '33333333-1212-1212-1212-121212121212',
      '33333333-3333-3333-3333-333333333333',
      '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'bank_import',
      'bank_csv',
      'event-100',
      102,
      '2026-02-01T14:00:00Z',
      '2026-02-01',
      12.000000,
      'USD',
      'inflow',
      'dedupe-hash-102'
    );
    RAISE EXCEPTION 'Expected replayed source_event_id violation';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.transactions (
      id,
      organization_id,
      bank_account_id,
      source_type,
      source_system,
      source_event_id,
      event_sequence,
      event_timestamp,
      booking_date,
      amount,
      currency_code,
      direction,
      dedupe_hash
    )
    VALUES (
      '33333333-1313-1313-1313-131313131313',
      '33333333-3333-3333-3333-333333333333',
      '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'bank_import',
      'bank_csv',
      'event-099',
      99,
      '2026-02-01T15:00:00Z',
      '2026-02-01',
      13.000000,
      'USD',
      'inflow',
      'dedupe-hash-103'
    );
    RAISE EXCEPTION 'Expected out-of-order sequence validation';
  EXCEPTION
    WHEN SQLSTATE '22000' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.payments (
      id,
      organization_id,
      payment_reference,
      source_account_id,
      beneficiary_counterparty_id,
      amount,
      currency_code,
      value_date,
      status,
      idempotency_key,
      created_by
    )
    VALUES (
      '33333333-1414-1414-1414-141414141414',
      '33333333-3333-3333-3333-333333333333',
      'PAY-CURR-MISMATCH',
      '33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      '33333333-cccc-cccc-cccc-cccccccccccc',
      50.000000,
      'EUR',
      '2026-02-05',
      'draft',
      'idem-curr-mismatch',
      'cccccccc-cccc-cccc-cccc-cccccccccccc'
    );
    RAISE EXCEPTION 'Expected payment currency mismatch validation';
  EXCEPTION
    WHEN SQLSTATE '23514' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.payments (
      id,
      organization_id,
      payment_reference,
      source_account_id,
      beneficiary_counterparty_id,
      amount,
      currency_code,
      value_date,
      status,
      idempotency_key,
      created_by
    )
    VALUES (
      '33333333-1515-1515-1515-151515151515',
      '33333333-3333-3333-3333-333333333333',
      'PAY-MISSING-ACCOUNT',
      '99999999-9999-9999-9999-999999999999',
      '33333333-cccc-cccc-cccc-cccccccccccc',
      75.000000,
      'USD',
      '2026-02-06',
      'draft',
      'idem-missing-account',
      'cccccccc-cccc-cccc-cccc-cccccccccccc'
    );
    RAISE EXCEPTION 'Expected missing source account foreign key violation';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
