BEGIN;

INSERT INTO public.organizations (id, name, base_currency, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Acme Treasury Corp', 'USD', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'Globex Finance Ltd', 'EUR', 'active')
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  base_currency = EXCLUDED.base_currency,
  status = EXCLUDED.status,
  updated_at = now();

INSERT INTO public.users (id, email, display_name, mfa_enabled)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'treasurer@acme.example', 'Acme Treasurer', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'approver@acme.example', 'Acme Approver', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'treasurer@globex.example', 'Globex Treasurer', true)
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  mfa_enabled = EXCLUDED.mfa_enabled,
  updated_at = now();

INSERT INTO public.roles (id, organization_id, name, is_system)
VALUES
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'treasurer', true),
  ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'approver', true),
  ('20000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'treasurer', true)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  is_system = EXCLUDED.is_system,
  updated_at = now();

INSERT INTO public.role_permissions (id, organization_id, role_id, permission_key)
VALUES
  ('30000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'payments.create'),
  ('30000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'payments.approve'),
  ('30000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'compliance.audit.read'),
  ('30000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'admin.roles.manage'),
  ('30000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000002', 'payments.approve'),
  ('30000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', '20000000-0000-0000-0000-000000000001', 'payments.create'),
  ('30000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'copilot.access'),
  ('30000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', '20000000-0000-0000-0000-000000000001', 'copilot.access'),
  ('30000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'liquidity.read'),
  ('30000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'liquidity.write'),
  ('30000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000002', 'liquidity.read')
ON CONFLICT (organization_id, role_id, permission_key) DO UPDATE
SET updated_at = now();

INSERT INTO public.organization_memberships (id, organization_id, user_id, role_id, status)
VALUES
  ('40000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '10000000-0000-0000-0000-000000000001', 'active'),
  ('40000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '10000000-0000-0000-0000-000000000002', 'active'),
  ('40000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '20000000-0000-0000-0000-000000000001', 'active')
ON CONFLICT (organization_id, user_id) DO UPDATE
SET
  role_id = EXCLUDED.role_id,
  status = EXCLUDED.status,
  updated_at = now();

DO $$
DECLARE
  v_auth_user_id uuid;
BEGIN
  SELECT id
  INTO v_auth_user_id
  FROM auth.users
  WHERE email = 'swanubhuti.jain@bacancy.com'
     OR id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
  LIMIT 1;

  IF v_auth_user_id IS NULL THEN
    v_auth_user_id := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      email_change_token_current,
      reauthentication_token,
      phone_change,
      phone_change_token,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_sso_user,
      is_anonymous
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_auth_user_id,
      'authenticated',
      'authenticated',
      'swanubhuti.jain@bacancy.com',
      crypt('#ted@28sanV', gen_salt('bf')),
      now(),
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      now(),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'sub', v_auth_user_id::text,
        'email', 'swanubhuti.jain@bacancy.com',
        'email_verified', true,
        'phone_verified', false
      ),
      false,
      false
    )
    ON CONFLICT (id) DO UPDATE
    SET
      instance_id = EXCLUDED.instance_id,
      aud = EXCLUDED.aud,
      role = EXCLUDED.role,
      email = EXCLUDED.email,
      encrypted_password = EXCLUDED.encrypted_password,
      email_confirmed_at = COALESCE(auth.users.email_confirmed_at, EXCLUDED.email_confirmed_at),
      confirmation_token = COALESCE(auth.users.confirmation_token, ''),
      recovery_token = COALESCE(auth.users.recovery_token, ''),
      email_change_token_new = COALESCE(auth.users.email_change_token_new, ''),
      email_change = COALESCE(auth.users.email_change, ''),
      email_change_token_current = COALESCE(auth.users.email_change_token_current, ''),
      reauthentication_token = COALESCE(auth.users.reauthentication_token, ''),
      phone_change = COALESCE(auth.users.phone_change, ''),
      phone_change_token = COALESCE(auth.users.phone_change_token, ''),
      raw_app_meta_data = EXCLUDED.raw_app_meta_data,
      raw_user_meta_data = EXCLUDED.raw_user_meta_data,
      updated_at = now();
  ELSE
    UPDATE auth.users
    SET
      instance_id = COALESCE(instance_id, '00000000-0000-0000-0000-000000000000'),
      aud = 'authenticated',
      role = 'authenticated',
      encrypted_password = crypt('#ted@28sanV', gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      confirmation_token = COALESCE(confirmation_token, ''),
      recovery_token = COALESCE(recovery_token, ''),
      email_change_token_new = COALESCE(email_change_token_new, ''),
      email_change = COALESCE(email_change, ''),
      email_change_token_current = COALESCE(email_change_token_current, ''),
      reauthentication_token = COALESCE(reauthentication_token, ''),
      phone_change = COALESCE(phone_change, ''),
      phone_change_token = COALESCE(phone_change_token, ''),
      raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
      raw_user_meta_data = jsonb_build_object(
        'sub', v_auth_user_id::text,
        'email', 'swanubhuti.jain@bacancy.com',
        'email_verified', true,
        'phone_verified', false
      ),
      updated_at = now()
    WHERE id = v_auth_user_id;
  END IF;

  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES (
    v_auth_user_id::text,
    v_auth_user_id,
    jsonb_build_object(
      'sub', v_auth_user_id::text,
      'email', 'swanubhuti.jain@bacancy.com',
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(),
    now(),
    now()
  )
  ON CONFLICT (provider_id, provider) DO UPDATE
  SET
    user_id = EXCLUDED.user_id,
    identity_data = EXCLUDED.identity_data,
    updated_at = now();
END $$;

INSERT INTO public.approval_workflows (id, organization_id, name, domain, is_active, version, conditions)
VALUES
  (
    '41000000-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'Default Payment Approval',
    'payments',
    true,
    1,
    '{"minAmount":"0.000000"}'::jsonb
  )
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active,
  conditions = EXCLUDED.conditions,
  updated_at = now();

INSERT INTO public.approval_steps (id, organization_id, workflow_id, step_order, role_id, min_approvals)
VALUES
  (
    '42000000-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '41000000-0000-0000-0000-000000000001',
    1,
    '10000000-0000-0000-0000-000000000001',
    1
  )
ON CONFLICT (id) DO UPDATE
SET
  step_order = EXCLUDED.step_order,
  role_id = EXCLUDED.role_id,
  min_approvals = EXCLUDED.min_approvals,
  updated_at = now();

INSERT INTO public.bank_connections (id, organization_id, provider, connection_type, status, config_encrypted)
VALUES
  ('50000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'JPMorgan API', 'open_banking', 'active', '{"profile":"prod-sim"}'::jsonb),
  ('50000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Deutsche Bank SFTP', 'sftp', 'active', '{"profile":"prod-sim"}'::jsonb)
ON CONFLICT (id) DO UPDATE
SET
  provider = EXCLUDED.provider,
  connection_type = EXCLUDED.connection_type,
  status = EXCLUDED.status,
  config_encrypted = EXCLUDED.config_encrypted,
  updated_at = now();

INSERT INTO public.bank_accounts (
  id,
  organization_id,
  bank_connection_id,
  account_name,
  account_number_masked,
  iban,
  swift_bic,
  currency_code,
  country_code,
  status
)
VALUES
  ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', 'Acme Operating USD', '****1234', NULL, 'CHASUS33', 'USD', 'US', 'active'),
  ('60000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', 'Acme Reserve USD', '****5678', NULL, 'CHASUS33', 'USD', 'US', 'active'),
  ('60000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', '50000000-0000-0000-0000-000000000001', 'Acme Restricted EUR', '****2468', 'DE12500105170648489890', 'CHASDEFX', 'EUR', 'DE', 'active'),
  ('60000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', '50000000-0000-0000-0000-000000000002', 'Globex Main EUR', '****9012', 'DE89370400440532013000', 'DEUTDEFF', 'EUR', 'DE', 'active')
ON CONFLICT (id) DO UPDATE
SET
  account_name = EXCLUDED.account_name,
  account_number_masked = EXCLUDED.account_number_masked,
  iban = EXCLUDED.iban,
  swift_bic = EXCLUDED.swift_bic,
  currency_code = EXCLUDED.currency_code,
  country_code = EXCLUDED.country_code,
  status = EXCLUDED.status,
  updated_at = now();

INSERT INTO public.counterparties (id, organization_id, name, type, country_code, risk_rating)
VALUES
  ('70000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Acme Payroll Vendor', 'vendor', 'US', 'A'),
  ('70000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Acme Customer North', 'customer', 'US', 'A'),
  ('70000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Globex Supplier EU', 'vendor', 'DE', 'BBB')
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  country_code = EXCLUDED.country_code,
  risk_rating = EXCLUDED.risk_rating,
  updated_at = now();

INSERT INTO public.bank_statement_import_jobs (
  id,
  organization_id,
  bank_connection_id,
  status,
  source_filename,
  started_at,
  completed_at,
  total_rows,
  processed_rows,
  failed_rows
)
VALUES
  (
    '80000000-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '50000000-0000-0000-0000-000000000001',
    'completed',
    'acme_stmt_20260313.csv',
    '2026-03-13T00:05:00Z',
    '2026-03-13T00:05:08Z',
    3,
    3,
    0
  )
ON CONFLICT (id) DO UPDATE
SET
  status = EXCLUDED.status,
  source_filename = EXCLUDED.source_filename,
  started_at = EXCLUDED.started_at,
  completed_at = EXCLUDED.completed_at,
  total_rows = EXCLUDED.total_rows,
  processed_rows = EXCLUDED.processed_rows,
  failed_rows = EXCLUDED.failed_rows,
  updated_at = now();

DO $$
DECLARE
  v_tx record;
  v_account_currency text;
  v_max_sequence bigint;
BEGIN
  IF to_regclass('pg_temp.tmp_seed_transactions') IS NOT NULL THEN
    DROP TABLE pg_temp.tmp_seed_transactions;
  END IF;

  CREATE TEMP TABLE tmp_seed_transactions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    bank_account_id uuid NOT NULL,
    counterparty_id uuid,
    ingestion_job_id uuid,
    source_type public.transaction_source_enum NOT NULL,
    source_system text NOT NULL,
    source_event_id text,
    event_sequence bigint,
    event_timestamp timestamptz NOT NULL,
    external_transaction_id text,
    booking_date date NOT NULL,
    value_date date,
    amount numeric(20,6) NOT NULL,
    currency_code text NOT NULL,
    direction public.transaction_direction_enum NOT NULL,
    description text,
    category text,
    dedupe_hash text NOT NULL,
    running_balance numeric(20,6),
    raw_payload jsonb NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_seed_transactions (
    id, organization_id, bank_account_id, counterparty_id, ingestion_job_id,
    source_type, source_system, source_event_id, event_sequence, event_timestamp,
    external_transaction_id, booking_date, value_date, amount, currency_code,
    direction, description, category, dedupe_hash, running_balance, raw_payload
  )
  VALUES
    (
      '90000000-0000-0000-0000-000000000001',
      '11111111-1111-1111-1111-111111111111',
      '60000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000002',
      '80000000-0000-0000-0000-000000000001',
      'bank_import',
      'jpmorgan',
      'evt-20260313-0001',
      1,
      '2026-03-13T00:01:00Z',
      'ext-1001',
      DATE '2026-03-13',
      DATE '2026-03-13',
      150000.000000,
      'USD',
      'inflow',
      'Customer settlement',
      'receivable',
      'acme-20260313-0001',
      150000.000000,
      '{"source":"bank_feed"}'::jsonb
    ),
    (
      '90000000-0000-0000-0000-000000000002',
      '11111111-1111-1111-1111-111111111111',
      '60000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000001',
      'bank_import',
      'jpmorgan',
      'evt-20260313-0002',
      2,
      '2026-03-13T00:02:00Z',
      'ext-1002',
      DATE '2026-03-13',
      DATE '2026-03-13',
      25000.000000,
      'USD',
      'outflow',
      'Vendor payment',
      'payable',
      'acme-20260313-0002',
      125000.000000,
      '{"source":"bank_feed"}'::jsonb
    ),
    (
      '90000000-0000-0000-0000-000000000003',
      '11111111-1111-1111-1111-111111111111',
      '60000000-0000-0000-0000-000000000001',
      NULL,
      NULL,
      'manual_adjustment',
      'treasury_ui',
      NULL,
      NULL,
      '2026-03-13T12:00:00Z',
      NULL,
      DATE '2026-03-13',
      DATE '2026-03-13',
      500.000000,
      'USD',
      'inflow',
      'Manual correction',
      'adjustment',
      'acme-20260313-manual-01',
      125500.000000,
      '{"source":"manual"}'::jsonb
    ),
    (
      '90000000-0000-0000-0000-000000000004',
      '22222222-2222-2222-2222-222222222222',
      '60000000-0000-0000-0000-000000000003',
      '70000000-0000-0000-0000-000000000003',
      NULL,
      'manual_adjustment',
      'treasury_ui',
      NULL,
      NULL,
      '2026-03-13T09:30:00Z',
      NULL,
      DATE '2026-03-13',
      DATE '2026-03-13',
      10000.000000,
      'EUR',
      'outflow',
      'Working capital adjustment',
      'adjustment',
      'globex-20260313-manual-01',
      10000.000000,
      '{"source":"manual"}'::jsonb
    ),
    (
      '90000000-0000-0000-0000-000000000005',
      '11111111-1111-1111-1111-111111111111',
      '60000000-0000-0000-0000-000000000002',
      NULL,
      NULL,
      'manual_adjustment',
      'treasury_ui',
      NULL,
      NULL,
      '2026-03-13T14:00:00Z',
      NULL,
      DATE '2026-03-13',
      DATE '2026-03-13',
      50000.000000,
      'USD',
      'inflow',
      'Reserve funding transfer',
      'liquidity',
      'acme-20260313-reserve-01',
      50000.000000,
      '{"source":"manual"}'::jsonb
    ),
    (
      '90000000-0000-0000-0000-000000000006',
      '11111111-1111-1111-1111-111111111111',
      '60000000-0000-0000-0000-000000000004',
      NULL,
      NULL,
      'manual_adjustment',
      'treasury_ui',
      NULL,
      NULL,
      '2026-03-13T16:30:00Z',
      NULL,
      DATE '2026-03-13',
      DATE '2026-03-13',
      20000.000000,
      'EUR',
      'inflow',
      'Restricted cash deposit',
      'liquidity',
      'acme-20260313-restricted-01',
      20000.000000,
      '{"source":"manual"}'::jsonb
    );

  FOR v_tx IN
    SELECT *
    FROM tmp_seed_transactions
    ORDER BY booking_date, event_timestamp, id
  LOOP
    BEGIN
      SELECT ba.currency_code::text
      INTO v_account_currency
      FROM public.bank_accounts ba
      WHERE ba.id = v_tx.bank_account_id
        AND ba.organization_id = v_tx.organization_id;

      IF v_account_currency IS NULL THEN
        RAISE NOTICE 'Skipping transaction %: bank account % not found for organization %',
          v_tx.id, v_tx.bank_account_id, v_tx.organization_id;
        CONTINUE;
      END IF;

      IF upper(trim(v_account_currency)) !~ '^[A-Z]{3}$' THEN
        RAISE NOTICE 'Skipping transaction %: invalid bank account currency %',
          v_tx.id, v_account_currency;
        CONTINUE;
      END IF;

      IF upper(trim(v_tx.currency_code)) !~ '^[A-Z]{3}$' THEN
        RAISE NOTICE 'Skipping transaction %: invalid transaction currency %',
          v_tx.id, v_tx.currency_code;
        CONTINUE;
      END IF;

      IF upper(trim(v_account_currency)) <> upper(trim(v_tx.currency_code)) THEN
        RAISE NOTICE 'Skipping transaction %: currency mismatch (tx=% account=%)',
          v_tx.id, v_tx.currency_code, v_account_currency;
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.transactions t
        WHERE t.id = v_tx.id
          AND t.booking_date = v_tx.booking_date
      ) THEN
        RAISE NOTICE 'Skipping transaction %: row already exists', v_tx.id;
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.transaction_dedupe_keys dk
        WHERE dk.organization_id = v_tx.organization_id
          AND dk.dedupe_hash = v_tx.dedupe_hash
      ) THEN
        RAISE NOTICE 'Skipping transaction %: dedupe hash already present (%)',
          v_tx.id, v_tx.dedupe_hash;
        CONTINUE;
      END IF;

      IF v_tx.source_event_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM public.transaction_source_events se
           WHERE se.organization_id = v_tx.organization_id
             AND se.source_system = lower(trim(v_tx.source_system))
             AND se.source_event_id = v_tx.source_event_id
         ) THEN
        RAISE NOTICE 'Skipping transaction %: source event already present (%/%).',
          v_tx.id, lower(trim(v_tx.source_system)), v_tx.source_event_id;
        CONTINUE;
      END IF;

      IF v_tx.source_type = 'bank_import' AND v_tx.event_sequence IS NULL THEN
        RAISE NOTICE 'Skipping transaction %: bank_import requires event_sequence', v_tx.id;
        CONTINUE;
      END IF;

      IF v_tx.event_sequence IS NOT NULL THEN
        SELECT max(t.event_sequence)
        INTO v_max_sequence
        FROM public.transactions t
        WHERE t.organization_id = v_tx.organization_id
          AND t.bank_account_id = v_tx.bank_account_id
          AND t.source_system = lower(trim(v_tx.source_system));

        IF v_max_sequence IS NOT NULL AND v_tx.event_sequence <= v_max_sequence THEN
          RAISE NOTICE 'Skipping transaction %: out-of-order event_sequence % (latest=%)',
            v_tx.id, v_tx.event_sequence, v_max_sequence;
          CONTINUE;
        END IF;
      END IF;

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
        external_transaction_id,
        booking_date,
        value_date,
        amount,
        currency_code,
        direction,
        description,
        category,
        dedupe_hash,
        running_balance,
        raw_payload
      )
      VALUES (
        v_tx.id,
        v_tx.organization_id,
        v_tx.bank_account_id,
        v_tx.counterparty_id,
        v_tx.ingestion_job_id,
        v_tx.source_type,
        lower(trim(v_tx.source_system)),
        v_tx.source_event_id,
        v_tx.event_sequence,
        v_tx.event_timestamp,
        v_tx.external_transaction_id,
        v_tx.booking_date,
        v_tx.value_date,
        round(v_tx.amount, 6),
        upper(trim(v_tx.currency_code))::public.currency_code,
        v_tx.direction,
        v_tx.description,
        v_tx.category,
        v_tx.dedupe_hash,
        v_tx.running_balance,
        v_tx.raw_payload
      );
    EXCEPTION
      WHEN others THEN
        RAISE NOTICE 'Skipping transaction % due to error: %', v_tx.id, SQLERRM;
    END;
  END LOOP;
END $$;

INSERT INTO public.currency_rates (
  id,
  base_currency,
  quote_currency,
  rate,
  as_of_at,
  provider
)
VALUES
  (
    '92000000-0000-0000-0000-000000000001',
    'EUR',
    'USD',
    1.08500000,
    '2026-03-14T00:00:00Z',
    'dev_seed'
  ),
  (
    '92000000-0000-0000-0000-000000000002',
    'USD',
    'EUR',
    0.92165899,
    '2026-03-14T00:00:00Z',
    'dev_seed'
  )
ON CONFLICT (base_currency, quote_currency, provider, as_of_at) DO UPDATE
SET
  rate = EXCLUDED.rate,
  provider = EXCLUDED.provider,
  updated_at = now();

INSERT INTO public.payments (
  id,
  organization_id,
  payment_reference,
  source_account_id,
  beneficiary_counterparty_id,
  amount,
  currency_code,
  value_date,
  purpose,
  status,
  idempotency_key,
  request_id,
  created_by,
  approval_workflow_id,
  approved_at
)
VALUES
  (
    '93000000-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'PAY-20260314-001',
    '60000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    18000.000000,
    'USD',
    DATE '2026-03-15',
    'Vendor release queue',
    'pending_approval',
    'seed-payments-001',
    'seed-request-001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '41000000-0000-0000-0000-000000000001',
    NULL
  ),
  (
    '93000000-0000-0000-0000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'PAY-20260314-002',
    '60000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000001',
    9500.000000,
    'USD',
    DATE '2026-03-17',
    'Payroll reserve hold',
    'approved',
    'seed-payments-002',
    'seed-request-002',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '41000000-0000-0000-0000-000000000001',
    '2026-03-14T08:45:00Z'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.risk_exposures (
  id,
  organization_id,
  risk_type,
  reference_date,
  currency_code,
  exposure_amount,
  status,
  details
)
VALUES
  (
    '94000000-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    'liquidity',
    DATE '2026-03-14',
    'USD',
    27500.000000,
    'warning',
    '{"policy":"minimum_liquidity_buffer"}'::jsonb
  ),
  (
    '94000000-0000-0000-0000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    'fx',
    DATE '2026-03-14',
    'EUR',
    20000.000000,
    'warning',
    '{"policy":"restricted_cash_translation"}'::jsonb
  )
ON CONFLICT (id) DO UPDATE
SET
  risk_type = EXCLUDED.risk_type,
  reference_date = EXCLUDED.reference_date,
  currency_code = EXCLUDED.currency_code,
  exposure_amount = EXCLUDED.exposure_amount,
  status = EXCLUDED.status,
  details = EXCLUDED.details,
  updated_at = now();

INSERT INTO public.cash_positions (
  id,
  organization_id,
  as_of_at,
  scope_type,
  scope_id,
  currency_code,
  available_balance,
  current_balance,
  source_version
)
VALUES
  (
    'a0000000-0000-0000-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    '2026-03-14T00:00:00Z',
    'account',
    '60000000-0000-0000-0000-000000000001',
    'USD',
    107500.000000,
    125500.000000,
    'v1'
  ),
  (
    'a0000000-0000-0000-0000-000000000002',
    '11111111-1111-1111-1111-111111111111',
    '2026-03-14T00:00:00Z',
    'account',
    '60000000-0000-0000-0000-000000000002',
    'USD',
    40500.000000,
    50000.000000,
    'v1'
  ),
  (
    'a0000000-0000-0000-0000-000000000004',
    '11111111-1111-1111-1111-111111111111',
    '2026-03-14T00:00:00Z',
    'account',
    '60000000-0000-0000-0000-000000000004',
    'EUR',
    20000.000000,
    20000.000000,
    'v1'
  ),
  (
    'a0000000-0000-0000-0000-000000000003',
    '11111111-1111-1111-1111-111111111111',
    '2026-03-14T00:00:00Z',
    'organization',
    '11111111-1111-1111-1111-111111111111',
    'USD',
    148000.000000,
    175500.000000,
    'v1'
  ),
  (
    'a0000000-0000-0000-0000-000000000005',
    '11111111-1111-1111-1111-111111111111',
    '2026-03-14T00:00:00Z',
    'organization',
    '11111111-1111-1111-1111-111111111111',
    'EUR',
    20000.000000,
    20000.000000,
    'v1'
  ),
  (
    'a0000000-0000-0000-0000-000000000006',
    '22222222-2222-2222-2222-222222222222',
    '2026-03-14T00:00:00Z',
    'organization',
    '22222222-2222-2222-2222-222222222222',
    'EUR',
    10000.000000,
    10000.000000,
    'v1'
  )
ON CONFLICT (id) DO UPDATE
SET
  as_of_at = EXCLUDED.as_of_at,
  scope_type = EXCLUDED.scope_type,
  scope_id = EXCLUDED.scope_id,
  currency_code = EXCLUDED.currency_code,
  available_balance = EXCLUDED.available_balance,
  current_balance = EXCLUDED.current_balance,
  source_version = EXCLUDED.source_version,
  updated_at = now();

-- Link real Supabase auth user to Acme Treasury Corp as treasurer
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'swanubhuti.jain@bacancy.com';

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.users (id, email, display_name, mfa_enabled)
    VALUES (v_user_id, 'swanubhuti.jain@bacancy.com', 'Swanubhuti Jain', false)
    ON CONFLICT (id) DO UPDATE
    SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      updated_at = now();

    INSERT INTO public.organization_memberships (id, organization_id, user_id, role_id, status)
    VALUES (
      gen_random_uuid(),
      '11111111-1111-1111-1111-111111111111',
      v_user_id,
      '10000000-0000-0000-0000-000000000001',
      'active'
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE
    SET
      role_id = EXCLUDED.role_id,
      status = EXCLUDED.status,
      updated_at = now();

    RAISE NOTICE 'Linked auth user % to Acme Treasury Corp', v_user_id;
  ELSE
    RAISE NOTICE 'Auth user swanubhuti.jain@bacancy.com not found — skipping membership insert. Sign up first, then re-run this seed.';
  END IF;
END $$;

COMMIT;
