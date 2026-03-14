# Changelog

## 2026-03-14

- Added payment initiation and approval slide-over workflows to the frontend payments module.
- Added frontend payment mutations, counterparty queries, auth-aware API helpers, and accessible confirmation/slide-over components.
- Added backend `/api/v1/counterparties` and enriched `GET /api/v1/payments/:paymentId` responses to support the new UI.
- Added a Supabase-backed `job_queue` table, queue claim RPC, and JSONB report artifact storage.
- Added background workers and scheduler support for `bank.sync`, `cash-position.recalculate`, and `report.generate`.
- Added admin job visibility endpoints at `GET /api/v1/jobs` and `GET /api/v1/jobs/:jobId`.
- Added live cash-position aggregation services, summary/history endpoints, and dashboard/account views wired to Supabase-backed balances instead of mock data.
- Added `restricted_balance` to `cash_positions`, plus `region`, `liquidity_type`, and `withdrawal_restricted` metadata on `bank_accounts` for regional liquidity reporting.
- Seeded live-demo payments, risk exposures, and currency rates to exercise pending-liquidity, watch-state, and FX-converted trapped-cash scenarios.
- Added a Claude-backed forecast engine with strict JSON/Zod validation, async long-horizon generation, stress-scenario generation, and forecast accuracy tracking.
- Extended forecast persistence with scenario metadata, generation state, AI narrative fields, daily confidence-band columns, and a new `usage_metrics` table for Anthropic token monitoring.
- Replaced the mock forecasts dashboard with a live treasury forecasting workspace including generation controls, Recharts area visualization, CSV export, stressed scenarios, and historical accuracy review.
- Added bank statement import support for MT940, CSV, and OFX files with parser-level error capture and focused parser tests.
- Added import-job status counters, direct file-processing support in the bank-sync worker, reconciliation persistence, and treasury exception notifications.
- Added a multi-step transaction import wizard with CSV mapping preview, job polling, and error-report download.
- Added a Treasury Copilot backend service with Claude tool-use orchestration across cash, approvals, FX, risk, forecasts, investments, debt, and transactions.
- Added encrypted `copilot_sessions` persistence, token-usage tracking, copilot chat/session API routes, and dedicated `copilot.chat` rate limiting.
- Added the dashboard Treasury Copilot workspace with session history, SSE streaming chat, markdown assistant responses, tool-call status feedback, and navigation access gated by `copilot.access`.
- Added SQL-backed reporting RPCs for cash summary, liquidity posture, and compliance evidence generation with live backend routes for JSON and CSV outputs.
- Added a report center UI with standard report generation, scheduled-report visibility, and compliance archive downloads.
- Added a permission-gated admin audit-log viewer with paginated filters, side-by-side JSON state inspection, and CSV export.
- Added an admin console for organization users, roles, and treasury policies, including policy JSON editing with Zod validation and invite/revoke admin actions.
- Added liquidity management backend contracts, repository/service logic, API routes, and focused tests for liquidity pools, sweeping rules, liquidity positions, and intercompany loans.
- Added the frontend liquidity dashboard with pool cards, manual sweep triggers, detail slide-over, concentration analytics, intercompany loan table, and create-loan workflow.
- Added migration `018_liquidity_rule_metadata.sql` for `sweeping_rules.rule_name` and `sweeping_rules.max_transfer`, plus local seed permissions for `liquidity.read` and `liquidity.write`.
- Added `risk_alerts`, live risk exposure snapshot APIs, breach detection orchestration, and the `risk.recalculate` worker for persisted FX, rate, counterparty, and liquidity stress monitoring.
- Replaced the mock risk exposure page with a live dashboard backed by TanStack Query, alert workflows, and liquidity stress visualization.
- Added a treasury policy-engine DSL, evaluator, `POLICY_VIOLATION` error flow, and payment-create enforcement with approval escalation and persisted payment notes.
- Added admin policy CRUD/validation routes at `GET|POST /api/v1/admin/policies`, `GET|PATCH|DELETE /api/v1/admin/policies/:policyId`, and `POST /api/v1/admin/policies/validate`.
- Added migration `020_policy_enforcement_support.sql` to persist `public.payments.notes` for policy warnings and approval context.
- Replaced raw JSON policy editing in the admin console with a visual rule/condition builder and added policy violation banners to the payment form.
- Added migration `020_notifications.sql` to evolve `public.notifications` with severity/title/body/action metadata, per-user read state, realtime publication, and 90-day soft-delete support.
- Added backend notification repository/service/routes for paginated list, unread count, mark read/read-all/unread, delivery queue fan-out, and notification templates for payments, risk, imports, forecasts, and reconciliation exceptions.
- Added notification delivery/cleanup workers plus a realtime notification bell, dropdown panel, toast stack, and full `/notifications` dashboard page in the frontend.
