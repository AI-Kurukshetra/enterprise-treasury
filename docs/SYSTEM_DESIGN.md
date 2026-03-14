# System Architecture Design

## Document Control
- Version: 0.1.0
- Date: March 14, 2026
- Status: Draft for implementation planning
- Scope: Enterprise Treasury & Cash Flow Command Center (MVP + extensible architecture)

## 1. Product and Architecture Summary
The platform is a multi-tenant, AI-first treasury SaaS that centralizes enterprise cash visibility, payments, forecasting, liquidity management, risk monitoring, debt and investment operations, and compliance auditing.

The architecture targets Kyriba-class treasury workflows with modern implementation patterns:
- Next.js App Router for unified frontend + backend boundary
- Supabase Postgres with strict Row Level Security (RLS)
- Event-driven domain workflows with immutable audit trails
- AI copilot and analytic tools exposed via MCP-compatible tool contracts

## 2. System Goals and Non-Goals
### Goals
- Provide consolidated multi-bank cash visibility by organization, entity, account, and currency.
- Support secure, idempotent payment initiation and multi-level approval.
- Deliver short-term and long-term cash forecasts with AI augmentation.
- Establish compliance-grade traceability for all financial actions.
- Enable treasury-specific AI workflows through typed MCP tools.

### Non-Goals (MVP)
- Full global payment rail coverage on day one.
- Real-time trading execution for complex derivatives.
- Full ERP ecosystem coverage beyond initial adapters.

## 3. Architecture Principles
1. Modular domain architecture with bounded contexts.
2. Strong typing across UI, API, domain, and persistence layers.
3. Zod validation at all external boundaries.
4. Security-first defaults (RLS, least privilege, MFA-ready).
5. Event-driven orchestration for critical workflows.
6. Idempotency for all payment and integration side effects.
7. Audit logging for all financial state transitions.
8. High observability with metrics, traces, and structured logs.
9. AI features are explainable, auditable, and policy-constrained.

## 4. High-Level Architecture
### Frontend Layer
- Next.js App Router + TypeScript
- Tailwind + shadcn/ui component system
- TanStack Query for server state and caching
- React Hook Form + Zod resolver for forms and validation

### Backend Application Layer
- Next.js Route Handlers for external/internal APIs
- Server Actions for trusted UI-triggered mutations
- Service modules grouped by treasury domain
- Shared validation and domain types package (local monorepo module pattern)

### Data Layer
- Supabase Postgres primary datastore
- Supabase Auth for identity and session management
- RLS policies on every tenant-bound table
- Outbox/event tables for reliable event emission

### AI and Agent Layer
- OpenAI API orchestration service
- MCP tool facade exposing treasury operations:
  - `get_cash_position`
  - `forecast_cashflow`
  - `calculate_fx_exposure`
  - `fetch_bank_transactions`
  - `execute_payment`
  - `generate_liquidity_report`
- Tool executions routed through policy checks, role checks, and audit logging

### Integration Layer
- Bank connectors (Open Banking APIs, SFTP/file imports)
- ERP connectors for GL sync and reconciliation input
- Market data providers for FX/rates/risk metrics

### Observability Layer
- Structured logs with request and trace correlation IDs
- Domain metrics (payment latency, failed imports, approval SLA)
- Alerting for operational and treasury risk anomalies

## 5. Domain-Driven Module Map
- `auth-access`: users, roles, sessions, permission enforcement
- `org-tenant`: organizations, entities, legal hierarchy
- `bank-connectivity`: accounts, connectors, statements, ingestion jobs
- `transactions-ledger`: normalized transaction records, reconciliation status
- `cash-positions`: intraday/daily consolidated positions
- `forecasting`: statistical + AI forecast generation and scenarioing
- `payments`: initiation, validation, idempotency, lifecycle state machine
- `approvals`: configurable multi-level approval workflow engine
- `liquidity`: pooling, sweeping rules, intercompany loans
- `risk`: FX/IR/credit exposure and policy thresholds
- `investments`: MMF holdings, maturities, performance
- `debt`: facilities, schedules, covenant tracking
- `policy-engine`: treasury rules and enforcement decisions
- `compliance-audit`: immutable audit logs, reports, evidence bundles
- `ai-copilot`: NLQ, recommendations, model governance logs

## 6. Core Runtime Flows
### 6.1 Cash Visibility Flow
1. Bank connector imports balances and transactions.
2. Ingestion pipeline normalizes records and deduplicates.
3. Reconciliation engine links transactions with internal references.
4. Cash position aggregator recalculates account/entity/org views.
5. Snapshot stored with timestamp and source lineage.

### 6.2 Payment Orchestration Flow
1. Client submits payment request with idempotency key.
2. Validation layer applies schema + policy checks.
3. Workflow engine determines approval chain.
4. Approvals collected with optimistic locking.
5. Final execution delegated to bank connector.
6. Status transitions and all actions appended to audit log.

### 6.3 Forecasting Flow
1. Historical transactions and cash positions are selected.
2. Feature pipeline generates seasonal and operational features.
3. Model service returns forecast plus confidence bounds.
4. Forecast scenario persisted with model metadata.
5. Copilot can explain drivers and variance factors.

## 7. Multi-Tenancy and Security Model
- Tenant isolation key: `organization_id` enforced at DB policy level.
- User access path: Auth identity -> membership -> role -> permission -> row access.
- Sensitive actions (payments, policy edits, connector credentials):
  - MFA-ready checkpoints
  - step-up authorization (policy-driven)
  - mandatory audit entries
- Secrets managed through secure env configuration and rotation policy.

## 8. Data Integrity and Reliability Patterns
- Idempotency table for external side-effect operations.
- Outbox pattern for reliable async event dispatch.
- Versioned rows for high-contention approval/payment records.
- Retry strategy with exponential backoff for bank/API transient failures.
- Dead-letter queue/table for failed ingestion events.

## 9. Event-Driven Design
### Event Categories
- `bank.*`: import_started, import_completed, import_failed
- `transaction.*`: created, reconciled, unreconciled
- `cash_position.*`: snapshot_generated
- `payment.*`: initiated, approved, rejected, sent, settled, failed
- `forecast.*`: generated, refreshed
- `risk.*`: threshold_breached
- `policy.*`: created, updated, activated

### Event Consumers
- Notification service
- Reporting materializer
- AI feature store updater
- Compliance evidence assembler

## 10. AI Architecture
### Treasury Copilot
- Natural language interpreter -> intent classifier -> tool planner.
- Executes only allow-listed MCP tools.
- Every AI action records:
  - prompt hash
  - tool invocation inputs/outputs
  - user actor and policy decision

### Predictive Cash Forecasting
- Hybrid model approach:
  - baseline statistical model for deterministic behavior
  - AI model for nonlinear patterns and anomaly contribution
- Backtesting metrics logged per organization and scenario.

### Risk Prediction
- Early warning signals from liquidity gap trends, concentration risk, and rate/FX volatility spikes.
- Outputs include explainability features and policy recommendations.

## 11. API and Validation Strategy
- REST-style grouped endpoints in Next.js route handlers.
- Shared Zod schemas for:
  - request validation
  - response typing
  - contract reuse in frontend forms
- Standard error envelope with machine-readable codes.
- Cursor pagination for high-volume domains (transactions, logs, events).

## 12. Edge Case Handling Strategy
- Bank API downtime: queue retries + stale-data flags in UI.
- Duplicate transactions: deterministic dedupe key and conflict review.
- Currency rate delays: fallback provider and stale-rate tolerance policy.
- Approval chain failures: escalation path and reassignment rules.
- Payment retries: idempotent re-execution only.
- Partial imports: chunk-level commit markers and resumable jobs.
- Network timeouts: bounded retries and circuit-breaker patterns.
- Cross-currency rounding: configurable precision and rounding policy table.
- Concurrent approvals: row version checks and replay-safe transitions.
- ERP sync conflicts: conflict queues with manual resolution workflow.
- Permission escalation attempts: deny + security audit event + alert.
- Data corruption recovery: immutable raw ingestion records + replay pipeline.

## 13. Observability and Operational Excellence
- Log schema fields: `request_id`, `organization_id`, `actor_id`, `domain`, `event_type`, `severity`.
- Core SLOs:
  - Payment execution success rate
  - Cash position freshness SLA
  - Forecast generation latency
  - Connector import success ratio
- Audit exports for SOC2-style evidence generation.

## 14. Deployment Topology
- Web/API: Next.js deployment runtime
- Database/Auth: Supabase project
- Async workers: background job runner (scheduled + queue-based)
- AI service: isolated service module with provider abstraction
- Environment tiers: local, staging, production with strict config parity

## 15. Development Phases
1. Foundation and security baseline
2. Data model and RLS implementation
3. API contracts and service scaffolding
4. MVP modules: accounts, cash positions, forecasting, payments, approvals, reports
5. AI copilot and predictive analytics
6. Advanced risk/liquidity/investment/debt modules
7. Hardening: observability, performance, security testing

## 16. Open Risks and Mitigations
- Bank integration variability: use connector adapters and contract tests.
- Forecast model drift: scheduled re-training and drift alerts.
- High-volume tenant performance: partitioning/index strategy and archival plan.
- Regulatory variation by geography: policy rule engine extensibility.
- AI recommendation trust: explanation and human approval gates.

## 17. Milestone Output (This Iteration)
This document establishes the production architecture baseline for implementing the first build milestone and aligns with:
- `docs/SCHEMA.md`
- `docs/API_SPEC.md`
