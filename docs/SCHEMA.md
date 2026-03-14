# Database Schema Documentation

## Document Control
- Version: 0.3.0
- Date: March 14, 2026
- Status: Implemented in Supabase SQL migrations
- Database: Supabase Postgres

## 1. Schema Design Goals
- Enforce strict tenant isolation with RLS.
- Maintain complete auditability for all financial state changes.
- Support idempotent and replay-safe financial operations.
- Optimize read paths for cash visibility and reporting.
- Keep schema extensible for additional connectors and risk models.

## 2. Conventions
- Primary keys: `uuid` (`gen_random_uuid()`)
- Tenant key: `organization_id` on all tenant-bound tables
- Timestamps: `created_at`, `updated_at` (`timestamptz`)
- Soft delete where needed: `deleted_at`
- Monetary and rate fields: `numeric(20,6)` + `currency_code char(3)`
- Non-monetary probabilistic metric: `confidence_score numeric(6,4)`
- Enum-like domain values: PostgreSQL enums for strict workflow states
- All writes of financial consequence create an `audit_logs` row

## 3. Core Entities

### 3.1 Identity and Access
#### `organizations`
- `id uuid pk`
- `name text not null`
- `base_currency char(3) not null`
- `status text not null` (active, suspended, archived)
- `created_at`, `updated_at`

#### `users`
- `id uuid pk` (maps to Supabase auth user id)
- `email text unique not null`
- `display_name text`
- `mfa_enabled boolean not null default false`
- `created_at`, `updated_at`

#### `organization_memberships`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `user_id uuid fk users(id)`
- `role_id uuid fk roles(id)`
- `status text not null` (invited, active, revoked)
- `created_at`, `updated_at`
- Unique: (`organization_id`, `user_id`)

#### `roles`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `name text not null`
- `is_system boolean not null default false`
- `created_at`, `updated_at`
- Unique: (`organization_id`, `name`)

#### `role_permissions`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `role_id uuid fk roles(id)`
- `permission_key text not null`
- Unique: (`organization_id`, `role_id`, `permission_key`)

### 3.2 Banking and Transactions
#### `bank_connections`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `provider text not null`
- `connection_type text not null` (open_banking, sftp, manual_file)
- `status text not null` (active, degraded, disconnected)
- `last_sync_at timestamptz`
- `config_encrypted jsonb not null`
- `created_at`, `updated_at`

#### `bank_accounts`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `bank_connection_id uuid fk bank_connections(id)`
- `account_name text not null`
- `account_number_masked text not null`
- `iban text`
- `swift_bic text`
- `currency_code char(3) not null`
- `country_code char(2)`
- `status text not null` (active, dormant, closed)
- `created_at`, `updated_at`

#### `counterparties`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `name text not null`
- `type text not null` (customer, vendor, bank, affiliate, other)
- `country_code char(2)`
- `risk_rating text`
- `created_at`, `updated_at`

#### `transactions`
- `id uuid` (partitioned table key uses composite pk: `id + booking_date`)
- `organization_id uuid fk organizations(id)`
- `bank_account_id uuid fk bank_accounts(id)`
- `counterparty_id uuid fk counterparties(id)`
- `source_type enum` (bank_import, manual_adjustment, payment_settlement, fx_conversion)
- `source_system text`
- `source_event_id text`
- `event_sequence bigint`
- `external_transaction_id text`
- `booking_date date not null`
- `value_date date`
- `amount numeric(20,6) not null`
- `currency_code char(3) not null`
- `direction text not null` (inflow, outflow)
- `description text`
- `category text`
- `reconciliation_status text not null default 'unreconciled'`
- `dedupe_hash text not null`
- `created_at`, `updated_at`
- Partitioning: monthly range partition by `booking_date` + default partition
- Global replay/dedupe safeguards:
  - `transaction_dedupe_keys` unique (`organization_id`, `dedupe_hash`)
  - `transaction_source_events` unique (`organization_id`, `source_system`, `source_event_id`)
- Indexes: (`organization_id`, `booking_date`), (`organization_id`, `bank_account_id`, `booking_date`)

#### `bank_statement_import_jobs`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `bank_connection_id uuid fk bank_connections(id)`
- `status text not null` (queued, running, partial, completed, failed)
- `source_filename text`
- `started_at`, `completed_at`
- `total_rows int`, `processed_rows int`, `failed_rows int`
- `error_summary jsonb`
- `created_at`, `updated_at`

### 3.3 Cash and Forecasting
#### `cash_positions`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `as_of_at timestamptz not null`
- `scope_type text not null` (account, entity, organization)
- `scope_id uuid`
- `currency_code char(3) not null`
- `available_balance numeric(20,6) not null`
- `current_balance numeric(20,6) not null`
- `source_version text not null`
- `created_at`
- Unique: (`organization_id`, `as_of_at`, `scope_type`, `scope_id`, `currency_code`)

#### `cash_flow_forecasts`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `name text not null`
- `forecast_type text not null` (short_term, long_term)
- `start_date date not null`
- `end_date date not null`
- `currency_code char(3) not null`
- `model_type text not null` (statistical, ai_hybrid)
- `model_version text not null`
- `confidence_score numeric(6,4)`
- `status text not null` (draft, published, superseded)
- `created_by uuid fk users(id)`
- `created_at`, `updated_at`

#### `cash_flow_forecast_lines`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `forecast_id uuid fk cash_flow_forecasts(id)`
- `forecast_date date not null`
- `projected_inflow numeric(20,6) not null default 0`
- `projected_outflow numeric(20,6) not null default 0`
- `projected_net numeric(20,6) not null`
- `scenario text not null default 'base'`
- Index: (`organization_id`, `forecast_id`, `forecast_date`)

### 3.4 Payments and Approvals
#### `payments`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `payment_reference text not null`
- `source_account_id uuid fk bank_accounts(id)`
- `beneficiary_counterparty_id uuid fk counterparties(id)`
- `amount numeric(20,6) not null`
- `currency_code char(3) not null`
- `value_date date not null`
- `purpose text`
- `status text not null` (draft, pending_approval, approved, rejected, sent, settled, failed, cancelled)
- `idempotency_key text not null`
- `created_by uuid fk users(id)`
- `approved_at timestamptz`
- `executed_at timestamptz`
- `created_at`, `updated_at`
- Unique: (`organization_id`, `idempotency_key`)
- Indexes: (`organization_id`, `status`, `created_at`), (`organization_id`, `value_date`)

#### `approval_workflows`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `name text not null`
- `domain text not null` (payments, policy_change, connector_change)
- `is_active boolean not null default true`
- `version int not null`
- `conditions jsonb not null`
- `created_at`, `updated_at`

#### `approval_steps`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `workflow_id uuid fk approval_workflows(id)`
- `step_order int not null`
- `role_id uuid fk roles(id)`
- `min_approvals int not null default 1`
- `created_at`, `updated_at`
- Unique: (`workflow_id`, `step_order`)

#### `payment_approvals`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `payment_id uuid fk payments(id)`
- `approval_step_id uuid fk approval_steps(id)`
- `approver_user_id uuid fk users(id)`
- `decision text not null` (approved, rejected)
- `comment text`
- `decided_at timestamptz not null`
- Unique: (`payment_id`, `approval_step_id`, `approver_user_id`)

### 3.5 Liquidity and Intercompany
#### `liquidity_pools`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `name text not null`
- `base_currency char(3) not null`
- `pool_type text not null` (physical, notional)
- `created_at`, `updated_at`

#### `sweeping_rules`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `liquidity_pool_id uuid fk liquidity_pools(id)`
- `source_account_id uuid fk bank_accounts(id)`
- `target_account_id uuid fk bank_accounts(id)`
- `min_balance numeric(20,6) not null`
- `target_balance numeric(20,6) not null`
- `frequency text not null` (daily, weekly, monthly)
- `is_active boolean not null default true`
- `created_at`, `updated_at`

#### `intercompany_transactions`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `lender_entity_id uuid not null`
- `borrower_entity_id uuid not null`
- `amount numeric(20,6) not null`
- `currency_code char(3) not null`
- `interest_rate numeric(20,6)`
- `maturity_date date`
- `status text not null` (proposed, active, settled, cancelled)
- `created_at`, `updated_at`

### 3.6 Risk, Market Data, FX
#### `currency_rates`
- `id uuid pk`
- `base_currency char(3) not null`
- `quote_currency char(3) not null`
- `rate numeric(20,8) not null`
- `provider text not null`
- `as_of_at timestamptz not null`
- `source_metadata jsonb not null default '{}'`
- `created_at`, `updated_at`
- Check: `base_currency <> quote_currency`
- Unique: (`base_currency`, `quote_currency`, `provider`, `as_of_at`)

#### `market_data`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `instrument_type text not null`
- `symbol text not null`
- `value numeric(20,6) not null`
- `as_of_at timestamptz not null`
- `source text not null`

#### `risk_exposures`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `risk_type text not null` (fx, interest_rate, credit, liquidity)
- `reference_date date not null`
- `currency_code char(3)`
- `exposure_amount numeric(20,6) not null`
- `var_95 numeric(20,6)`
- `status text not null` (normal, warning, breached)
- `details jsonb`
- `created_at`
- Index: (`organization_id`, `risk_type`, `reference_date`)

#### `hedging_instruments`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `instrument_type text not null` (forward, option, swap)
- `notional_amount numeric(20,6) not null`
- `base_currency char(3) not null`
- `quote_currency char(3)`
- `strike_rate numeric(20,6)`
- `maturity_date date not null`
- `status text not null` (draft, active, matured, closed)
- `created_at`, `updated_at`

### 3.7 Investments and Debt
#### `investments`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `instrument_name text not null`
- `instrument_type text not null` (mmf, td, bond, other)
- `principal_amount numeric(20,6) not null`
- `currency_code char(3) not null`
- `rate numeric(20,6)`
- `start_date date not null`
- `maturity_date date not null`
- `status text not null` (active, matured, redeemed)
- `created_at`, `updated_at`

#### `debt_facilities`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `facility_name text not null`
- `facility_type text not null` (revolver, term_loan, overdraft)
- `lender_counterparty_id uuid fk counterparties(id)`
- `limit_amount numeric(20,6) not null`
- `utilized_amount numeric(20,6) not null default 0`
- `currency_code char(3) not null`
- `interest_basis text`
- `covenant_summary jsonb`
- `status text not null` (active, suspended, closed)
- `created_at`, `updated_at`

#### `debt_schedules`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `debt_facility_id uuid fk debt_facilities(id)`
- `due_date date not null`
- `principal_due numeric(20,6) not null default 0`
- `interest_due numeric(20,6) not null default 0`
- `status text not null` (scheduled, paid, overdue)
- `created_at`, `updated_at`

### 3.8 Policy and Compliance
#### `treasury_policies`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `policy_name text not null`
- `policy_type text not null` (payment_limit, exposure_limit, liquidity_threshold, approval_rule)
- `version int not null`
- `rules jsonb not null`
- `is_active boolean not null default true`
- `effective_from date not null`
- `effective_to date`
- `created_by uuid fk users(id)`
- `created_at`, `updated_at`

#### `compliance_reports`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `report_type text not null`
- `period_start date not null`
- `period_end date not null`
- `status text not null` (draft, generated, approved, filed)
- `artifact_uri text`
- `created_at`, `updated_at`

#### `audit_logs`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `user_id uuid fk users(id)`
- `action text not null`
- `entity_type text not null`
- `entity_id uuid`
- `request_id text`
- `source_channel text`
- `previous_state jsonb`
- `new_state jsonb`
- `metadata jsonb`
- `occurred_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`
- Indexes: (`organization_id`, `occurred_at`), (`organization_id`, `entity_type`, `occurred_at`)

### 3.9 Reliability and Integration Support
#### `idempotency_keys`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `operation text not null`
- `idempotency_key text not null`
- `request_hash text not null`
- `response_snapshot jsonb`
- `status text not null` (in_progress, completed, failed)
- `expires_at timestamptz`
- `created_at`, `updated_at`
- Unique: (`organization_id`, `operation`, `idempotency_key`)

#### `integration_sync_jobs`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `integration_type text not null` (erp, bank, market_data)
- `direction text not null` (import, export)
- `status text not null` (queued, running, completed, failed, partial)
- `started_at`, `completed_at`
- `error_details jsonb`
- `created_at`, `updated_at`

#### `event_outbox`
- `id uuid pk`
- `organization_id uuid fk organizations(id)`
- `event_type text not null`
- `aggregate_type text not null`
- `aggregate_id uuid not null`
- `payload jsonb not null`
- `status text not null` (pending, published, failed)
- `published_at timestamptz`
- `created_at`
- Index: (`status`, `created_at`)

## 4. RLS Strategy

### 4.1 Baseline Policies
For all tenant-bound tables:
- `SELECT`: allowed where user has active membership in row `organization_id`.
- `INSERT`: allowed where inserted `organization_id` is in active memberships and permission check passes.
- `UPDATE/DELETE`: allowed by membership + explicit permission keys.

### 4.2 Elevated Domain Policies
- `payments`: only users with `payments.create` can create; `payments.approve` required for approval rows.
- `treasury_policies`: only `policy.manage` permission can mutate.
- `bank_connections`: only `integrations.manage` role can update credentials/status.
- `audit_logs`: insert-only by service role; no update/delete for tenant users.

### 4.3 Service Role Boundaries
- Background workers use service role for system operations.
- Service role writes must include `actor_user_id` if action originates from a user request.
- Internal jobs annotate `metadata.system_actor` for audit clarity.
- `cash_positions_latest` is configured as a `security_invoker` view to ensure underlying table RLS is enforced for caller identity.

## 5. Constraints and Data Quality Rules
- `currency_code` uses a strict `currency_code` domain and `validate_currency()` format guard (`[A-Z]{3}`).
- Domain validation allows `NULL` at type boundary so trigger-local domain variables do not fail at runtime; column `NOT NULL` still enforces required currency fields.
- Monetary values use fixed precision, no floating-point fields.
- `payments.amount > 0` enforced by check constraint.
- Approval step ordering strictly increasing per workflow.
- No duplicate transaction dedupe hash or source event replay per organization.
- Payment status transitions enforced via trigger state machine and row versioning.

## 6. Indexing Strategy
- High-volume partitioned indexes on `transactions` for organization/date/account scan paths.
- Workflow indexes on `payments`, `payment_approvals`, `approval_steps`, `bank_statement_import_jobs`.
- Reporting indexes on `cash_positions`, `risk_exposures`, `intercompany_transactions`, `audit_logs`.
- Partition maintenance functions:
  - `configure_transactions_partition(regclass)`
  - `create_transaction_month_partition(date)`
  - `ensure_future_transaction_partitions(months_ahead)`

## 7. Migration Plan (Implemented)
Supabase migrations were implemented in deterministic order under `supabase/migrations/`:
1. `001_extensions_and_enums.sql`
2. `002_organizations_and_users.sql`
3. `003_bank_accounts.sql`
4. `004_transactions.sql`
5. `005_cash_positions.sql`
6. `006_cash_forecasts.sql`
7. `007_payments.sql`
8. `008_approval_workflows.sql`
9. `009_liquidity_management.sql`
10. `010_risk_exposures.sql`
11. `011_investments.sql`
12. `012_debt_facilities.sql`
13. `013_audit_logs.sql`
14. `014_rls_policies.sql`
15. `015_indexes_and_performance.sql`
16. `016_operational_support_tables.sql`
17. `017_financial_hardening.sql`

Current implemented scope intentionally prioritizes the user-requested core treasury entities and controls, with the operational support tables added in a follow-up increment once the backend audit confirmed they were already runtime dependencies.
Implemented in follow-up schema increment: `treasury_policies`, `compliance_reports`, `integration_sync_jobs`.
Deferred (documented for next migration cycle): `event_outbox`.

## 8. Edge Cases Mapped to Schema
- Duplicate bank imports -> trigger + `transaction_dedupe_keys` unique (`organization_id`, `dedupe_hash`).
- Replayed API/source events -> `transaction_source_events` unique (`organization_id`, `source_system`, `source_event_id`).
- Payment idempotency -> `payments.idempotency_key` and `idempotency_keys` table.
- Concurrent approvals -> unique approval tuple + payment row lock and versioned updates.
- Partial statement imports -> `bank_statement_import_jobs` counters and status.
- Currency mismatch protection -> transaction/payment triggers verify account currency alignment.
- Out-of-order transaction events -> sequence guard in transaction integrity trigger.
- Stale approval workflows -> workflow deactivation guard and payment workflow validation trigger.
- Fraud/permission escalation alerts -> immutable `audit_logs` + RLS policy boundaries.

## 9. Testing Guidance for Schema Phase
- RLS tests for each role and table operation.
- Constraint tests for money, enums, and uniqueness.
- High-contention tests for payment approval updates.
- Import dedupe and replay tests for transaction ingestion.
- Executable validation scripts are maintained under `test/database/`:
  - `01_rls_isolation.sql`
  - `02_constraints_validation.sql`
  - `03_audit_logging.sql`
  - `04_partition_integrity.sql`
