# Master Task List

## Milestone 1: Architecture and Contracts (Completed)
- [x] Analyze product scope and treasury domain requirements
- [x] Define system architecture blueprint
- [x] Define enterprise data model and RLS strategy
- [x] Define API surface and contract conventions
- [x] Capture initial architecture decisions

## Milestone 2: Database Build (Completed)
- [x] Create `supabase/migrations/001_extensions_and_enums.sql`
- [x] Create tenant, auth, and access-control tables
- [x] Create banking, transactions, and cash position tables
- [x] Create forecasting, payments, approvals tables
- [x] Create risk, investment, debt, compliance tables
- [x] Implement RLS policies for all tenant-bound tables
- [x] Add seed data for local development and policy smoke tests

## Milestone 3: Backend Services (Completed)
- [x] Implement route handlers for MVP domains
- [x] Implement domain services and repositories
- [x] Add idempotency middleware for payment routes
- [x] Implement audit logging middleware/hooks
- [x] Add integration job orchestration primitives

## Milestone 4: Frontend MVP Dashboards (Completed)
- [x] Build auth shell and role-aware navigation
- [x] Build cash visibility dashboard
- [x] Build payments and approval workflow UI
- [x] Build forecasting and reporting views
- [x] Build enterprise marketing landing page
- [x] Build reusable account, payment, and transaction data tables
- [x] Integrate frontend query layer with `/api/v1/accounts`, `/api/v1/payments`, and `/api/v1/transactions`
- [x] Add financial analytics charts for cash trend, liquidity mix, and payment volume
- [x] Add frontend project scaffold under `frontend/` with strict TypeScript, Tailwind, shadcn-style primitives, and TanStack Query

## Milestone 5: AI and MCP
- [ ] Implement Treasury Copilot service layer
- [ ] Expose MCP-compatible treasury tools
- [ ] Add forecast/risk AI endpoints with audit controls

## Milestone 6: Quality and Ops (In Progress)
- [x] Add Vitest unit and API contract-path coverage for core backend flows
- [x] Run backend production-readiness audit and harden core fintech controls
- [x] Add request context, tracing placeholders, rate limiting, and error-tracking hooks
- [x] Align payment/approval backend logic with the persisted SQL workflow and optimistic-locking contract
- [x] Add middleware coverage for audit logging, idempotency propagation, and rate limiting
- [x] Add operational support tables required by existing backend repositories and routes
- [x] Run Supabase production-readiness database audit and fix migration/RLS issues
- [x] Add SQL validation suite under `test/database/` (RLS isolation, constraints, audit, partition integrity)
- [x] Add Supabase local DB runbook and correct `supabase/config.toml` seed path
- [x] Restore FX reference schema gap with additive `022_currency_rates.sql` migration and verify full local reset+seed
- [x] Seed and verify local login identity `swanubhuti.jain@bacancy.com` in both `auth.users` and `public.users` with active organization membership
- [x] Implement layered backend QA architecture under `backend/tests`
- [x] Add service, repository, security, concurrency, performance, and financial-property tests for core treasury domains
- [x] Add direct API integration coverage for `/api/v1/accounts`, `/transactions`, `/payments`, `/approvals`, `/cash-positions`, `/forecasts`, and `/investments`
- [x] Add CI-ready scripts for `test`, `test:coverage`, and `test:e2e`
- [x] Prepare Playwright E2E coverage scaffold for core payment workflows
- [ ] Activate DB-backed repository integration tests against Supabase test instance
- [ ] Activate live Playwright E2E workflows after frontend integration
- [ ] Implement executable `liquidity_management` service coverage after the service module exists
- [ ] Add observability dashboards and alerts
- [x] Run performance and security hardening checklist
- [x] Validate frontend typecheck and production build
