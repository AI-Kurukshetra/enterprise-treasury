import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const envPath = resolve(repoRoot, '.env.local');
const envFile = readFileSync(envPath, 'utf8');

for (const line of envFile.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    continue;
  }

  const [rawKey, ...rest] = trimmed.split('=');
  if (!rawKey || rest.length === 0) {
    continue;
  }

  const rawValue = rest.join('=').trim();
  process.env[rawKey.trim()] = rawValue.replace(/^"(.*)"$/, '$1');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required in .env.local');
}

const expectedTables = [
  'organizations',
  'users',
  'roles',
  'role_permissions',
  'organization_memberships',
  'bank_connections',
  'bank_accounts',
  'counterparties',
  'bank_statement_import_jobs',
  'transaction_dedupe_keys',
  'transaction_source_events',
  'transactions',
  'cash_positions',
  'idempotency_keys',
  'payments',
  'approval_workflows',
  'approval_steps',
  'payment_approvals',
  'liquidity_pools',
  'liquidity_pool_accounts',
  'sweeping_rules',
  'intercompany_transactions',
  'cash_flow_forecasts',
  'cash_flow_forecast_lines',
  'risk_exposures',
  'hedging_instruments',
  'investments',
  'debt_facilities',
  'debt_schedules',
  'audit_logs',
  'treasury_policies',
  'compliance_reports',
  'integration_sync_jobs',
  'currency_rates',
  'job_queue',
  'expected_receipts',
  'transaction_reconciliations',
  'notifications',
  'risk_alerts',
  'usage_metrics',
  'copilot_sessions'
];

const coreMigrationPrefixes = ['001', '002', '003', '004', '007', '013', '014', '015', '017'];
const requiredHighVolumeIndexes = {
  transactions: [
    'idx_transactions_org_booking_date',
    'idx_transactions_org_account_booking_date',
    'idx_transactions_org_created_at'
  ],
  payments: [
    'idx_payments_org_status_created',
    'idx_payments_org_value_date',
    'idx_payments_org_status_value_date'
  ],
  audit_logs: [
    'idx_audit_logs_org_occurred',
    'idx_audit_logs_org_entity_occurred',
    'idx_audit_logs_org_action_occurred'
  ]
};

function runPsqlJsonQuery(sql) {
  const wrapped = `select coalesce(json_agg(row_to_json(t)), '[]'::json)::text from (${sql}) as t;`;
  const result = spawnSync('psql', [databaseUrl, '-X', '-A', '-t', '-c', wrapped], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: '10',
      PGTZ: 'UTC'
    }
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    throw new Error(stderr.length > 0 ? stderr : `psql exited with status ${result.status}`);
  }

  const stdout = result.stdout.trim();
  return stdout ? JSON.parse(stdout) : [];
}

function reportTablePresence(tables) {
  const found = new Set(tables.map((row) => row.table_name));
  const missing = expectedTables.filter((table) => !found.has(table));

  return {
    totalExpected: expectedTables.length,
    foundCount: expectedTables.length - missing.length,
    missing
  };
}

function reportRls(rows) {
  const disabled = rows
    .filter((row) => expectedTables.includes(row.table_name) && !row.rls_enabled)
    .map((row) => row.table_name)
    .sort();

  return {
    checked: rows.filter((row) => expectedTables.includes(row.table_name)).length,
    disabled
  };
}

function reportMigrations(rows) {
  const versions = rows.map((row) => String(row.version));
  const satisfied = coreMigrationPrefixes.filter((prefix) => versions.some((version) => version.startsWith(prefix)));
  const missing = coreMigrationPrefixes.filter((prefix) => !satisfied.includes(prefix));

  return {
    versions,
    satisfied,
    missing
  };
}

function reportIndexes(rows) {
  const byTable = rows.reduce((accumulator, row) => {
    const current = accumulator[row.table_name] ?? [];
    current.push(row.index_name);
    accumulator[row.table_name] = current;
    return accumulator;
  }, {});

  const missingByTable = Object.entries(requiredHighVolumeIndexes).reduce((accumulator, [tableName, expected]) => {
    const actual = new Set(byTable[tableName] ?? []);
    accumulator[tableName] = expected.filter((indexName) => !actual.has(indexName));
    return accumulator;
  }, {});

  return {
    byTable,
    missingByTable
  };
}

try {
  const tables = runPsqlJsonQuery(`
    select tablename as table_name
    from pg_tables
    where schemaname = 'public'
    order by tablename
  `);

  const rls = runPsqlJsonQuery(`
    select tablename as table_name, rowsecurity as rls_enabled
    from pg_tables
    where schemaname = 'public'
    order by tablename
  `);

  const migrations = runPsqlJsonQuery(`
    select version
    from supabase_migrations.schema_migrations
    order by version
  `);

  const indexes = runPsqlJsonQuery(`
    select tablename as table_name, indexname as index_name
    from pg_indexes
    where schemaname = 'public'
      and tablename in ('transactions', 'payments', 'audit_logs')
    order by tablename, indexname
  `);

  const tableReport = reportTablePresence(tables);
  const rlsReport = reportRls(rls);
  const migrationReport = reportMigrations(migrations);
  const indexReport = reportIndexes(indexes);

  console.log(JSON.stringify({
    tableReport,
    rlsReport,
    migrationReport,
    indexReport
  }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : 'Unknown database audit failure'
      },
      null,
      2
    )
  );
  process.exit(1);
}
