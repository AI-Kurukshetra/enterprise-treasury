# Architecture Decisions

## ADR-001: Monolithic Next.js Runtime with Modular Domain Services
- Date: 2026-03-14
- Decision: Use Next.js App Router with route handlers and server actions as the application boundary, while keeping domain logic in modular service layers.
- Rationale: Maximizes delivery velocity while preserving clear separation of domain concerns.

## ADR-002: Supabase Postgres as System of Record with Strict RLS
- Date: 2026-03-14
- Decision: All tenant-bound tables include `organization_id` and enforce RLS policies by default.
- Rationale: Financial SaaS requires strong tenant isolation and least privilege guarantees.

## ADR-003: Event-Driven Reliability via Outbox Pattern
- Date: 2026-03-14
- Decision: Persist domain events in `event_outbox` for durable asynchronous processing.
- Rationale: Prevents event loss and enables reliable downstream workflows (notifications, reporting, AI feature updates).

## ADR-004: Idempotency Required for Payment Side Effects
- Date: 2026-03-14
- Decision: Payment initiation and retry-sensitive operations require idempotency keys tracked in durable storage.
- Rationale: Prevents duplicate financial execution under retries/timeouts.

## ADR-005: AI Features Must be Policy-Gated and Auditable
- Date: 2026-03-14
- Decision: MCP tool executions and AI-assisted actions run through the same authz and audit pipeline as direct API usage.
- Rationale: AI in treasury workflows must remain explainable, traceable, and compliant.

## ADR-006: Shared Zod Contracts Across Frontend and Backend
- Date: 2026-03-14
- Decision: Use shared Zod schemas for all request/response payload contracts.
- Rationale: Reduces contract drift and improves type safety across layers.

## ADR-007: PRD Source-of-Truth Fallback for This Iteration
- Date: 2026-03-14
- Decision: Use the user-provided detailed treasury specification as the implementation baseline because `docs/PRD.md` currently contains only a heading placeholder.
- Rationale: Avoids blocking architecture and backend implementation while preserving consistency with already-authored system design and API/schema docs.

## ADR-008: Clean Architecture Backend Layout Under `backend/`
- Date: 2026-03-14
- Decision: Enforce repository-only database access, service-layer business logic, middleware-driven request context, and thin route handlers in `/api/v1`.
- Rationale: Keeps fintech-critical behaviors testable, auditable, and maintainable at scale.

## ADR-009: Strict TypeScript with Practical Compiler Settings
- Date: 2026-03-14
- Decision: Keep strict TypeScript enabled while removing `exactOptionalPropertyTypes` to reduce high-friction optional-field mapping noise at API boundaries.
- Rationale: Preserves strong type safety and delivery speed for this phase; optional strictness can be reintroduced incrementally after schema stabilization.

## ADR-010: Partitioned Transactions Use Composite Primary Key
- Date: 2026-03-14
- Decision: Implement `transactions` as a range-partitioned table by `booking_date` with primary key `(id, booking_date)` and global dedupe/replay protection in helper tables.
- Rationale: PostgreSQL partitioned uniqueness constraints require partition key inclusion; this design preserves date partition scalability while maintaining deterministic dedupe guarantees.

## ADR-011: Users Table Not Hard-FK'd to `auth.users`
- Date: 2026-03-14
- Decision: Keep `public.users` as application profile identity without a direct foreign key to `auth.users`.
- Rationale: Avoids fragile coupling to Supabase-managed auth internals and simplifies deterministic local seed data while retaining identity mapping via shared UUIDs.

## ADR-012: Currency Validation Uses ISO-Style Alpha-3 Guard at DB Boundary
- Date: 2026-03-14
- Decision: Enforce currency codes through `currency_code` domain + `validate_currency()` format check (`[A-Z]{3}`) on all financial tables.
- Rationale: Guarantees fixed-format ISO 4217-compatible values at the database boundary while allowing future extension to canonical reference-table validation without breaking schema contracts.

## ADR-013: Initial Migration Scope Prioritizes Core Treasury Entities
- Date: 2026-03-14
- Decision: Implement the 15 requested migrations focused on core operational treasury entities and controls first; defer `treasury_policies`, `compliance_reports`, `integration_sync_jobs`, and `event_outbox` to the next schema increment.
- Rationale: Aligns implementation with the explicit migration order and critical enterprise treasury path (cash, transactions, payments, approvals, risk, debt, investments, audit, RLS) while preserving deterministic delivery.

## ADR-014: Operational Support Tables Promoted from Deferred to Implemented
- Date: 2026-03-14
- Decision: Add `treasury_policies`, `compliance_reports`, and `integration_sync_jobs` in `supabase/migrations/016_operational_support_tables.sql` because backend routes and repositories already depended on them.
- Rationale: Production readiness requires the database contract to match the exposed backend surface; keeping those tables deferred created hard runtime failures behind otherwise valid endpoints.

## ADR-015: Request Context, Rate Limiting, and Version-Based Approval Guards Are Mandatory
- Date: 2026-03-14
- Decision: Introduce async request context propagation, route-level rate limiting, audit-log correlation, and payment status updates guarded by the persisted `payments.version` field instead of `updated_at`.
- Rationale: These controls close replay, stale-approval, and observability gaps that are unacceptable in a fintech payment workflow.

## ADR-016: Defense-in-Depth Treasury Test Architecture
- Date: 2026-03-14
- Decision: Standardize backend verification on a layered TypeScript test architecture under `backend/tests` using Vitest for unit/service/repository/security/concurrency/performance tests, Supertest for socket-based API integration tests, and Playwright for end-to-end workflow coverage.
- Rationale: Treasury-grade software needs deterministic validation at the business-rule, repository, route, security, concurrency, and workflow layers rather than relying on route smoke tests alone.

## ADR-017: Route-Invocation Integration Tests are the Runnable Baseline in This Environment
- Date: 2026-03-14
- Decision: Keep the Supertest suite in-repo, but gate its execution behind `ENABLE_SUPERTEST_SOCKET_TESTS=1` and use direct Next.js route invocation tests as the default runnable API integration layer.
- Rationale: The current local sandbox blocks localhost socket binding, so direct route invocation is the only deterministic way to validate the route contract here without dropping API integration coverage.

## ADR-018: Documented Testing/Implementation Drift
- Date: 2026-03-14
- Decision: Record and preserve the following current mismatches until they are resolved:
  - `docs/PRD.md` is still a placeholder and cannot serve as the authoritative product source.
  - `backend/src/services/liquidity_management` does not exist even though the documentation scope includes liquidity management as a first-class service area.
  - Earlier progress notes that indicated the backend test/typecheck baseline was already green were stale; the suite required additional fixes before the new QA architecture could pass.
- Rationale: Fintech auditability requires that known contract and implementation gaps are explicit rather than silently absorbed into test assumptions.

## ADR-019: Security-Invoker Read Views for Tenant Data Are Mandatory
- Date: 2026-03-14
- Decision: Configure tenant-facing aggregation views such as `cash_positions_latest` with `security_invoker=true` and least-privilege grants so underlying table RLS is always evaluated in caller context.
- Rationale: Default definer-rights view execution can bypass tenant isolation and leak cross-tenant rows even when base table RLS is correctly configured.

## ADR-020: Partition Hardening Must Be Applied at Partition Creation Time
- Date: 2026-03-14
- Decision: Introduce `configure_transactions_partition(regclass)` and make `create_transaction_month_partition()` call it so every new monthly partition gets RLS, policies, and critical indexes immediately.
- Rationale: Hardening only existing partitions during migrations leaves future partitions at risk of inconsistent security and degraded query performance.

## ADR-021: Currency Domain Validation Must Allow NULL at Type Boundary
- Date: 2026-03-14
- Decision: Keep `currency_code` format guard (`[A-Z]{3}`) but allow `NULL` in `validate_currency()` so domain-typed PL/pgSQL variables can initialize safely; requiredness remains enforced by column-level `NOT NULL`.
- Rationale: Strict non-null domain checks can cause runtime trigger failures unrelated to actual persisted data validity.

## ADR-022: FX Reference Rates Stay Global, Tenant Data Stays Isolated
- Date: 2026-03-14
- Decision: Keep `public.currency_rates` as a global reference table (no `organization_id`), enforce RLS with authenticated read + service-role write, and restore it via additive migration `022_currency_rates.sql`.
- Rationale: Provider FX rates are shared market reference data and should not be duplicated per tenant, while tenant-owned financial records remain isolated through organization-scoped schemas and policies.
