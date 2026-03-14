\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.organizations (id, name, base_currency, status)
VALUES ('44444444-4444-4444-4444-444444444444', 'Audit Org', 'USD', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, email)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'audit-user@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roles (id, organization_id, name, is_system)
VALUES ('dddddddd-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', 'member', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_memberships (id, organization_id, user_id, role_id, status)
VALUES ('dddddddd-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'dddddddd-4444-4444-4444-444444444444', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.bank_connections (id, organization_id, provider, connection_type, status)
VALUES ('44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'test-bank', 'manual_file', 'active')
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
  '44444444-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '44444444-4444-4444-4444-444444444444',
  '44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Audit USD Account',
  '****4444',
  'USD',
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.counterparties (id, organization_id, name, type)
VALUES ('44444444-cccc-cccc-cccc-cccccccccccc', '44444444-4444-4444-4444-444444444444', 'Audit Beneficiary', 'vendor')
ON CONFLICT (id) DO NOTHING;

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
  created_by,
  purpose
)
VALUES (
  '44444444-eeee-eeee-eeee-eeeeeeeeeeee',
  '44444444-4444-4444-4444-444444444444',
  'PAY-AUDIT-001',
  '44444444-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '44444444-cccc-cccc-cccc-cccccccccccc',
  125.000000,
  'USD',
  '2026-02-10',
  'draft',
  'idem-audit-001',
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'initial purpose'
)
ON CONFLICT (id) DO NOTHING;

UPDATE public.payments
SET purpose = 'updated purpose'
WHERE id = '44444444-eeee-eeee-eeee-eeeeeeeeeeee'
  AND organization_id = '44444444-4444-4444-4444-444444444444';

DO $$
DECLARE
  v_count integer;
  v_log_id uuid;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.audit_logs al
  WHERE al.organization_id = '44444444-4444-4444-4444-444444444444'
    AND al.entity_type = 'payments'
    AND al.entity_id = '44444444-eeee-eeee-eeee-eeeeeeeeeeee';

  IF v_count < 2 THEN
    RAISE EXCEPTION 'Expected at least 2 payment audit entries (insert + update), got %', v_count;
  END IF;

  SELECT al.id INTO v_log_id
  FROM public.audit_logs al
  WHERE al.organization_id = '44444444-4444-4444-4444-444444444444'
    AND al.entity_type = 'payments'
    AND al.entity_id = '44444444-eeee-eeee-eeee-eeeeeeeeeeee'
  ORDER BY al.occurred_at DESC
  LIMIT 1;

  BEGIN
    UPDATE public.audit_logs
    SET action = action
    WHERE id = v_log_id;
    RAISE EXCEPTION 'Expected audit log immutability failure on update';
  EXCEPTION
    WHEN SQLSTATE '22000' THEN NULL;
  END;
END;
$$;

ROLLBACK;
