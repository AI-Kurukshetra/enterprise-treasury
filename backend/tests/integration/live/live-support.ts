import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resetEnvCache } from '@/config/env';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../..');
const envPath = resolve(repoRoot, '.env.local');

export const LIVE_ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333';
export const LIVE_APPROVER_ROLE_ID = '33333333-3333-4333-8333-333333333002';
export const LIVE_ACCOUNT_PRIMARY_ID = '33333333-3333-4333-8333-333333333201';
export const LIVE_ACCOUNT_SECONDARY_ID = '33333333-3333-4333-8333-333333333202';
export const LIVE_COUNTERPARTY_ID = '33333333-3333-4333-8333-333333333301';

const LIVE_BANK_CONNECTION_ID = '33333333-3333-4333-8333-333333333101';
const LIVE_APPROVAL_WORKFLOW_ID = '33333333-3333-4333-8333-333333333401';
const LIVE_APPROVAL_STEP_ID = '33333333-3333-4333-8333-333333333402';
const LIVE_INVESTMENT_ID = '33333333-3333-4333-8333-333333333501';
const LIVE_DEBT_FACILITY_ID = '33333333-3333-4333-8333-333333333601';
const LIVE_DEBT_SCHEDULE_ID = '33333333-3333-4333-8333-333333333602';
const LIVE_RISK_EXPOSURE_ID = '33333333-3333-4333-8333-333333333701';
const LIVE_CASH_POSITION_ACCOUNT_ID = '33333333-3333-4333-8333-333333333801';
const LIVE_CASH_POSITION_ACCOUNT_2_ID = '33333333-3333-4333-8333-333333333802';
const LIVE_CASH_POSITION_ORG_ID = '33333333-3333-4333-8333-333333333803';
const LIVE_TRANSACTION_ID = '33333333-3333-4333-8333-333333333901';

const LIVE_PERMISSION_SET = [
  'payments.create',
  'reports.read',
  'liquidity.read',
  'liquidity.write',
  'admin.audit_logs.read',
  'risk.calculate'
] as const;

interface LiveClients {
  anonClient: SupabaseClient;
  serviceClient: SupabaseClient;
}

export interface ProvisionedUser {
  id: string;
  email: string;
  password: string;
  organizationId: string;
}

function logSeedWarning(scope: string, message: string) {
  console.warn(`[live-audit][seed-warning] ${scope}: ${message}`);
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function loadRootEnv(): void {
  const envFile = readFileSync(envPath, 'utf8');

  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] = stripWrappingQuotes(rawValue);
  }

  process.env.ANTHROPIC_API_KEY ||= 'test-anthropic-key-for-live-audit';
  process.env.ALLOWED_ORIGINS ||=
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001';

  resetEnvCache();
}

export function createLiveClients(): LiveClients {
  loadRootEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error('Missing live Supabase credentials in root .env.local');
  }

  return {
    anonClient: createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }),
    serviceClient: createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  };
}

export async function seedLiveOrganizationData(serviceClient: SupabaseClient): Promise<void> {
  const { error: organizationError } = await serviceClient.from('organizations').upsert(
    {
      id: LIVE_ORGANIZATION_ID,
      name: 'Atlas Treasury QA Audit Org',
      base_currency: 'USD',
      status: 'active'
    },
    { onConflict: 'id' }
  );
  if (organizationError) {
    throw new Error(`Failed to seed live organization: ${organizationError.message}`);
  }

  const { error: approverRoleError } = await serviceClient.from('roles').upsert(
    {
      id: LIVE_APPROVER_ROLE_ID,
      organization_id: LIVE_ORGANIZATION_ID,
      name: 'qa_live_approver',
      is_system: false
    },
    { onConflict: 'id' }
  );
  if (approverRoleError) {
    throw new Error(`Failed to seed approver role: ${approverRoleError.message}`);
  }

  const { error: approverPermissionError } = await serviceClient.from('role_permissions').upsert(
    {
      organization_id: LIVE_ORGANIZATION_ID,
      role_id: LIVE_APPROVER_ROLE_ID,
      permission_key: 'payments.approve'
    },
    { onConflict: 'organization_id,role_id,permission_key' }
  );
  if (approverPermissionError) {
    throw new Error(`Failed to seed approver permission: ${approverPermissionError.message}`);
  }

  const { error: bankConnectionError } = await serviceClient.from('bank_connections').upsert(
    {
      id: LIVE_BANK_CONNECTION_ID,
      organization_id: LIVE_ORGANIZATION_ID,
      provider: 'QA Connected Bank',
      connection_type: 'open_banking',
      status: 'active',
      config_encrypted: { profile: 'qa-live', region: 'US' }
    },
    { onConflict: 'id' }
  );
  if (bankConnectionError) {
    throw new Error(`Failed to seed bank connection: ${bankConnectionError.message}`);
  }

  const { error: bankAccountsError } = await serviceClient.from('bank_accounts').upsert(
    [
      {
        id: LIVE_ACCOUNT_PRIMARY_ID,
        organization_id: LIVE_ORGANIZATION_ID,
        bank_connection_id: LIVE_BANK_CONNECTION_ID,
        account_name: 'QA Operating USD',
        account_number_masked: '****3201',
        iban: null,
        swift_bic: 'QABKUS33',
        currency_code: 'USD',
        country_code: 'US',
        status: 'active'
      },
      {
        id: LIVE_ACCOUNT_SECONDARY_ID,
        organization_id: LIVE_ORGANIZATION_ID,
        bank_connection_id: LIVE_BANK_CONNECTION_ID,
        account_name: 'QA Reserve USD',
        account_number_masked: '****3202',
        iban: null,
        swift_bic: 'QABKUS33',
        currency_code: 'USD',
        country_code: 'US',
        status: 'active'
      }
    ],
    { onConflict: 'id' }
  );
  if (bankAccountsError) {
    throw new Error(`Failed to seed bank accounts: ${bankAccountsError.message}`);
  }

  const { error: counterpartyError } = await serviceClient.from('counterparties').upsert(
    {
      id: LIVE_COUNTERPARTY_ID,
      organization_id: LIVE_ORGANIZATION_ID,
      name: 'QA Beneficiary Vendor',
      type: 'vendor',
      country_code: 'US',
      risk_rating: 'A'
    },
    { onConflict: 'id' }
  );
  if (counterpartyError) {
    throw new Error(`Failed to seed counterparty: ${counterpartyError.message}`);
  }

  const { error: workflowError } = await serviceClient.from('approval_workflows').upsert(
    {
      id: LIVE_APPROVAL_WORKFLOW_ID,
      organization_id: LIVE_ORGANIZATION_ID,
      name: 'QA Payment Approval',
      domain: 'payments',
      is_active: true,
      version: 1,
      conditions: { minAmount: '0.000000' }
    },
    { onConflict: 'id' }
  );
  if (workflowError) {
    throw new Error(`Failed to seed approval workflow: ${workflowError.message}`);
  }

  const { error: workflowStepError } = await serviceClient.from('approval_steps').upsert(
    {
      id: LIVE_APPROVAL_STEP_ID,
      organization_id: LIVE_ORGANIZATION_ID,
      workflow_id: LIVE_APPROVAL_WORKFLOW_ID,
      step_order: 1,
      role_id: LIVE_APPROVER_ROLE_ID,
      min_approvals: 1
    },
    { onConflict: 'id' }
  );
  if (workflowStepError) {
    throw new Error(`Failed to seed approval step: ${workflowStepError.message}`);
  }

  const { data: primaryAccountRow } = await serviceClient
    .from('bank_accounts')
    .select('currency_code')
    .eq('id', LIVE_ACCOUNT_PRIMARY_ID)
    .eq('organization_id', LIVE_ORGANIZATION_ID)
    .maybeSingle();

  const seededCurrencyCode =
    primaryAccountRow &&
    typeof primaryAccountRow === 'object' &&
    'currency_code' in primaryAccountRow &&
    typeof primaryAccountRow.currency_code === 'string'
      ? primaryAccountRow.currency_code
      : 'USD';

  const { error: transactionError } = await serviceClient.from('transactions').upsert(
    {
      id: LIVE_TRANSACTION_ID,
      organization_id: LIVE_ORGANIZATION_ID,
      bank_account_id: LIVE_ACCOUNT_PRIMARY_ID,
      counterparty_id: LIVE_COUNTERPARTY_ID,
      ingestion_job_id: null,
      source_type: 'bank_import',
      source_system: 'qa-live',
      source_event_id: 'qa-live-transaction-1',
      event_sequence: 1,
      event_timestamp: '2026-03-14T09:00:00Z',
      external_transaction_id: 'qa-live-ext-transaction-1',
      booking_date: '2026-03-14',
      value_date: '2026-03-14',
      amount: '12500.000000',
      currency_code: seededCurrencyCode,
      direction: 'inflow',
      description: 'QA live receivable',
      category: 'receivable',
      dedupe_hash: 'qa-live-dedupe-transaction-1',
      running_balance: '12500.000000',
      raw_payload: { source: 'qa-live-audit' }
    },
    { onConflict: 'id,booking_date' }
  );
  if (transactionError) {
    logSeedWarning('transactions', transactionError.message);
  }

  const { error: cashPositionError } = await serviceClient.from('cash_positions').upsert(
    [
      {
        id: LIVE_CASH_POSITION_ACCOUNT_ID,
        organization_id: LIVE_ORGANIZATION_ID,
        as_of_at: '2026-03-14T00:00:00Z',
        scope_type: 'account',
        scope_id: LIVE_ACCOUNT_PRIMARY_ID,
        currency_code: 'USD',
        available_balance: '225000.000000',
        current_balance: '250000.000000',
        restricted_balance: '25000.000000',
        source_version: 'qa-live-v1'
      },
      {
        id: LIVE_CASH_POSITION_ACCOUNT_2_ID,
        organization_id: LIVE_ORGANIZATION_ID,
        as_of_at: '2026-03-14T00:00:00Z',
        scope_type: 'account',
        scope_id: LIVE_ACCOUNT_SECONDARY_ID,
        currency_code: 'USD',
        available_balance: '140000.000000',
        current_balance: '150000.000000',
        restricted_balance: '10000.000000',
        source_version: 'qa-live-v1'
      },
      {
        id: LIVE_CASH_POSITION_ORG_ID,
        organization_id: LIVE_ORGANIZATION_ID,
        as_of_at: '2026-03-14T00:00:00Z',
        scope_type: 'organization',
        scope_id: LIVE_ORGANIZATION_ID,
        currency_code: 'USD',
        available_balance: '365000.000000',
        current_balance: '400000.000000',
        restricted_balance: '35000.000000',
        source_version: 'qa-live-v1'
      }
    ],
    { onConflict: 'id' }
  );
  if (cashPositionError) {
    logSeedWarning('cash_positions', cashPositionError.message);
  }

  const { error: investmentError } = await serviceClient.from('investments').upsert(
    {
      id: LIVE_INVESTMENT_ID,
      organization_id: LIVE_ORGANIZATION_ID,
      instrument_name: 'QA Treasury MMF',
      instrument_type: 'mmf',
      principal_amount: '50000.000000',
      currency_code: 'USD',
      start_date: '2026-03-01',
      maturity_date: '2026-04-01',
      rate: '0.045000',
      status: 'active'
    },
    { onConflict: 'id' }
  );
  if (investmentError) {
    logSeedWarning('investments', investmentError.message);
  }

  const { error: debtFacilityError } = await serviceClient.from('debt_facilities').upsert(
    {
      id: LIVE_DEBT_FACILITY_ID,
      organization_id: LIVE_ORGANIZATION_ID,
      facility_name: 'QA Revolver',
      facility_type: 'revolver',
      lender_counterparty_id: LIVE_COUNTERPARTY_ID,
      limit_amount: '250000.000000',
      utilized_amount: '100000.000000',
      currency_code: 'USD',
      status: 'active'
    },
    { onConflict: 'id' }
  );
  if (debtFacilityError) {
    logSeedWarning('debt_facilities', debtFacilityError.message);
  }

  const { error: debtScheduleError } = await serviceClient.from('debt_schedules').upsert(
    {
      id: LIVE_DEBT_SCHEDULE_ID,
      organization_id: LIVE_ORGANIZATION_ID,
      debt_facility_id: LIVE_DEBT_FACILITY_ID,
      due_date: '2026-06-30',
      principal_due: '10000.000000',
      interest_due: '2500.000000',
      status: 'scheduled'
    },
    { onConflict: 'id' }
  );
  if (debtScheduleError) {
    logSeedWarning('debt_schedules', debtScheduleError.message);
  }

  const { error: riskExposureError } = await serviceClient.from('risk_exposures').upsert(
    {
      id: LIVE_RISK_EXPOSURE_ID,
      organization_id: LIVE_ORGANIZATION_ID,
      risk_type: 'liquidity',
      reference_date: '2026-03-14',
      currency_code: 'USD',
      exposure_amount: '30000.000000',
      status: 'warning',
      details: {
        title: 'Liquidity buffer',
        currentCashBuffer: '365000.000000',
        baselineMinimumCashBuffer: '250000.000000',
        warningThresholdRatio: '0.800000',
        forecastWindowDays: 30
      }
    },
    { onConflict: 'id' }
  );
  if (riskExposureError) {
    logSeedWarning('risk_exposures', riskExposureError.message);
  }
}

export async function ensureAuditRole(serviceClient: SupabaseClient): Promise<string> {
  const roleName = `qa_live_auditor_${Date.now()}`;
  const { data: roleRow, error: roleError } = await serviceClient
    .from('roles')
    .insert({
      organization_id: LIVE_ORGANIZATION_ID,
      name: roleName,
      is_system: false
    })
    .select('id')
    .single();

  if (roleError || !roleRow) {
    throw new Error(`Failed to create live audit role: ${roleError?.message ?? 'missing role row'}`);
  }

  const roleId = (roleRow as { id: string }).id;
  const { error: permissionError } = await serviceClient.from('role_permissions').insert(
    LIVE_PERMISSION_SET.map((permissionKey) => ({
      organization_id: LIVE_ORGANIZATION_ID,
      role_id: roleId,
      permission_key: permissionKey
    }))
  );

  if (permissionError) {
    throw new Error(`Failed to seed live audit permissions: ${permissionError.message}`);
  }

  return roleId;
}

function buildCredential(prefix: string): { email: string; password: string } {
  const uniqueSuffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `${prefix}.${uniqueSuffix}@atlas-treasury.test`,
    password: `Audit${uniqueSuffix.toUpperCase()}9`
  };
}

export async function provisionUser(
  serviceClient: SupabaseClient,
  options: {
    displayName: string;
    roleId: string;
    prefix: string;
  }
): Promise<ProvisionedUser> {
  const credential = buildCredential(options.prefix);
  const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
    email: credential.email,
    password: credential.password,
    email_confirm: true,
    user_metadata: {
      full_name: options.displayName
    }
  });

  if (authError || !authData.user) {
    throw new Error(`Failed to provision auth user ${options.prefix}: ${authError?.message ?? 'missing auth user'}`);
  }

  const userId = authData.user.id;
  const { error: userError } = await serviceClient.from('users').upsert({
    id: userId,
    email: credential.email,
    display_name: options.displayName,
    mfa_enabled: false
  });

  if (userError) {
    throw new Error(`Failed to upsert public.users for ${credential.email}: ${userError.message}`);
  }

  const { error: membershipError } = await serviceClient.from('organization_memberships').insert({
    organization_id: LIVE_ORGANIZATION_ID,
    user_id: userId,
    role_id: options.roleId,
    status: 'active'
  });

  if (membershipError) {
    throw new Error(`Failed to create membership for ${credential.email}: ${membershipError.message}`);
  }

  return {
    id: userId,
    email: credential.email,
    password: credential.password,
    organizationId: LIVE_ORGANIZATION_ID
  };
}

export async function signInUser(
  anonClient: SupabaseClient,
  email: string,
  password: string
): Promise<string> {
  const { data, error } = await anonClient.auth.signInWithPassword({
    email,
    password
  });

  if (error || !data.session?.access_token) {
    throw new Error(`Failed to sign in ${email}: ${error?.message ?? 'missing session token'}`);
  }

  return data.session.access_token;
}

export function buildAuthHeaders(accessToken: string, extraHeaders?: Record<string, string>) {
  return {
    authorization: `Bearer ${accessToken}`,
    'x-organization-id': LIVE_ORGANIZATION_ID,
    'x-request-id': `qa-live-${Date.now()}`,
    ...extraHeaders
  };
}
