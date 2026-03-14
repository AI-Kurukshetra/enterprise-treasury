import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
const envFile = readFileSync(envPath, 'utf-8');
envFile.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const client = createClient(url, serviceKey, { auth: { persistSession: false } });

const tables = [
  'organizations', 'users', 'roles', 'role_permissions', 'organization_memberships',
  'bank_connections', 'bank_accounts', 'counterparties',
  'transactions', 'cash_positions',
  'payments', 'idempotency_keys',
  'approval_workflows', 'approval_steps', 'payment_approvals',
  'cash_flow_forecasts', 'cash_flow_forecast_lines',
  'investments', 'debt_facilities', 'debt_schedules',
  'currency_rates',
  'risk_exposures', 'hedging_instruments',
  'audit_logs', 'treasury_policies', 'compliance_reports',
  'integration_sync_jobs', 'liquidity_pools', 'sweeping_rules',
  'intercompany_transactions'
];

console.log(`\n📋 Checking all ${tables.length} tables in Supabase...\n`);

let found = 0, missing = 0;
for (const table of tables) {
  const { error } = await client.from(table).select('*').limit(1);
  const exists = !error || error.code === 'PGRST116'; // PGRST116 = empty table (OK)
  const schemaError = error?.message?.includes('schema cache');
  if (!error || error.code === 'PGRST116') {
    console.log(`  ✅ ${table}`);
    found++;
  } else if (schemaError || error?.code === '42P01') {
    console.log(`  ❌ ${table} — NOT FOUND (migration not run)`);
    missing++;
  } else {
    console.log(`  ⚠️  ${table} — ${error.message}`);
    missing++;
  }
}

console.log(`\n📊 Result: ${found}/${tables.length} tables exist`);
if (missing > 0) {
  console.log(`   ❌ ${missing} tables missing — run migrations first\n`);
  console.log('   Run: supabase db push  (from project root)\n');
} else {
  console.log('   ✅ All tables exist — database is ready!\n');
}
