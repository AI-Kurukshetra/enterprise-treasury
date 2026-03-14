# API Specification

## Document Control
- Version: 0.1.0
- Date: March 14, 2026
- Status: Draft for backend implementation
- Runtime: Next.js Route Handlers + Server Actions

## 1. API Standards
- Base path: `/api/v1`
- Auth: Supabase Auth JWT
- Content type: `application/json`
- Validation: Zod schemas for all inputs and outputs
- Timestamps: ISO 8601 UTC
- Money precision: string decimal in API payloads to preserve precision
- Pagination: cursor-based (`cursor`, `limit`)

## 2. Security and Access
- Every request resolves `organization_id` from user membership context.
- All domain routes require authenticated user except initial auth routes.
- Authorization uses permission keys at route boundary.
- Financial mutation routes require:
  - request correlation id (`X-Request-Id`)
  - idempotency key (`Idempotency-Key`) where applicable
- Rate limiting applies by user and organization on sensitive endpoints.

## 3. Standard Response Envelopes
### Success
```json
{
  "data": {},
  "meta": {
    "requestId": "req_123",
    "timestamp": "2026-03-14T10:00:00Z"
  }
}
```

### Error
```json
{
  "error": {
    "code": "PAYMENT_POLICY_VIOLATION",
    "message": "Payment exceeds configured policy limit",
    "details": {}
  },
  "meta": {
    "requestId": "req_123",
    "timestamp": "2026-03-14T10:00:00Z"
  }
}
```

## 4. Error Code Families
- `AUTH_*` authentication/session failures
- `ACCESS_*` authorization/permission failures
- `VALIDATION_*` schema validation failures
- `CONFLICT_*` optimistic concurrency/idempotency conflicts
- `INTEGRATION_*` bank/ERP/market provider failures
- `PAYMENT_*` payment lifecycle or policy failures
- `FORECAST_*` forecasting request/model failures
- `RISK_*` exposure calculation failures
- `SYSTEM_*` unexpected internal errors

## 5. Endpoint Groups

## 5.1 `/auth`
### `POST /auth/login`
- Purpose: session bootstrap via Supabase Auth flow proxy
- Body: `{ email, password }`
- Returns: session metadata and user profile summary

### `POST /auth/logout`
- Purpose: terminate current session
- Returns: `{ success: true }`

### `GET /auth/me`
- Purpose: get current user, memberships, and effective permissions

## 5.2 `/accounts`
### `GET /accounts`
- Filters: `status`, `currencyCode`, `bankConnectionId`
- Returns: paginated bank accounts

### `POST /accounts`
- Permission: `accounts.create`
- Body: account metadata and connection link

### `GET /accounts/:accountId`
- Returns account details + latest balance snapshot

### `PATCH /accounts/:accountId`
- Permission: `accounts.update`
- Supports status changes and metadata updates

## 5.3 `/transactions`
### `GET /transactions`
- Filters: date range, account, amount min/max, direction, reconciliation status
- Returns normalized transactions with reconciliation fields

### `POST /transactions/import`
- Permission: `transactions.import`
- Purpose: manual file import trigger
- Returns import job id

### `POST /transactions/:transactionId/reconcile`
- Permission: `transactions.reconcile`
- Body: reconciliation target references

## 5.4 `/cash-positions`
### `GET /cash-positions/latest`
- Params: `scopeType`, `scopeId`, optional `currencyCode`
- Returns latest consolidated balances

### `GET /cash-positions/history`
- Params: date range + scope filters
- Returns time-series cash position snapshots

## 5.5 `/forecasts`
### `GET /forecasts`
- Filters: type, status, date range

### `POST /forecasts`
- Permission: `forecasts.create`
- Body: forecast config (horizon, currency, scenario)
- Triggers async forecast generation workflow

### `GET /forecasts/:forecastId`
- Returns forecast metadata and daily lines

### `POST /forecasts/:forecastId/publish`
- Permission: `forecasts.publish`

## 5.6 `/payments`
### `GET /payments`
- Filters: status, date range, account, amount, beneficiary

### `POST /payments`
- Permission: `payments.create`
- Headers: `Idempotency-Key` required
- Body: payment instruction payload
- Behavior: validates policy + creates approval workflow assignment

### `GET /payments/:paymentId`
- Returns full lifecycle details, approvals, connector status

### `POST /payments/:paymentId/cancel`
- Permission: `payments.cancel`
- Allowed only in pre-execution states

### `POST /payments/:paymentId/retry`
- Permission: `payments.retry`
- Headers: `Idempotency-Key` required
- Uses original idempotency semantics and execution guards

## 5.7 `/approvals`
### `GET /approvals/pending`
- Returns pending approvals assigned to current user

### `POST /approvals/:paymentId/approve`
- Permission: `payments.approve`
- Body: `rowVersionToken` + optional comment
- Concurrency guard: payment row version token required

### `POST /approvals/:paymentId/reject`
- Permission: `payments.approve`
- Body: `rowVersionToken` + reason

## 5.8 `/reports`
### `GET /reports/cash-summary`
- Returns summarized balances by entity, currency, and bank

### `GET /reports/liquidity`
- Returns liquidity pool view, sweeping outcomes, shortfall indicators

### `POST /reports/compliance`
- Permission: `reports.generate`
- Generates compliance report artifact

## 5.9 `/risk`
### `GET /risk/exposures`
- Filters: risk type, date, currency

### `POST /risk/exposures/recalculate`
- Permission: `risk.calculate`
- Triggers recalculation job

### `GET /risk/alerts`
- Returns active warning/breach events

## 5.10 `/investments`
### `GET /investments`
- Filters: status, maturity window, instrument type

### `POST /investments`
- Permission: `investments.create`

### `GET /investments/:investmentId`
- Returns instrument and maturity profile

## 5.11 `/debt`
### `GET /debt/facilities`
- Returns utilization and covenant status

### `POST /debt/facilities`
- Permission: `debt.create`

### `GET /debt/facilities/:facilityId/schedule`
- Returns payment schedule lines

## 5.12 `/fx`
### `GET /fx/rates`
- Params: `base`, `quote`, `asOf`

### `GET /fx/exposure`
- Returns net exposure by currency and hedge coverage

### `POST /fx/hedges/recommend`
- Permission: `risk.hedging.recommend`
- Returns AI-assisted hedge recommendations with rationale

## 5.13 `/integrations`
### `GET /integrations/banks`
- Returns configured bank connectors and sync health

### `POST /integrations/banks`
- Permission: `integrations.manage`
- Creates bank connection record and starts verification flow

### `POST /integrations/banks/:connectionId/sync`
- Permission: `integrations.sync`
- Triggers connector synchronization

### `GET /integrations/sync-jobs`
- Returns job history for bank/ERP/market sync

## 5.14 `/notifications`
### `GET /notifications`
- Returns user-scoped operational and risk notifications

### `PATCH /notifications/:notificationId/read`
- Marks notification as read

## 5.15 `/admin`
### `GET /admin/users`
- Permission: `admin.users.read`

### `POST /admin/roles`
- Permission: `admin.roles.manage`

### `POST /admin/policies`
- Permission: `policy.manage`

### `GET /admin/audit-logs`
- Permission: `compliance.audit.read`
- Filters: actor, domain, action, date range

## 6. Zod Schema Strategy
- Shared package location (planned): `backend/src/schemas/*`
- Naming convention:
  - `CreatePaymentRequestSchema`
  - `CreatePaymentResponseSchema`
  - `PaymentStatusEnumSchema`
- Coerce and sanitize input where safe (`z.coerce.date()`, trimmed strings)
- Use refinements for domain invariants:
  - positive monetary values
  - valid currency pairs
  - approval workflow consistency

## 7. Idempotency, Concurrency, and Retries
- Required for `POST /payments` and retry/replay-sensitive integration routes.
- Idempotency key uniqueness scoped by organization and operation.
- Concurrency control via the persisted payment row version token.
- Retry policy:
  - safe for transient integration failures
  - blocked for semantic/payment policy failures

## 8. Audit and Compliance Hooks
Financial mutations must write audit events with:
- actor identity
- organization id
- action and resource
- before and after snapshots
- request id and source channel (UI, API, MCP)

## 9. MCP Tool Mapping
- `get_cash_position` -> `/cash-positions/latest`
- `forecast_cashflow` -> `/forecasts` create + fetch
- `calculate_fx_exposure` -> `/fx/exposure`
- `fetch_bank_transactions` -> `/transactions`
- `execute_payment` -> `/payments`
- `generate_liquidity_report` -> `/reports/liquidity`

All MCP-triggered operations must pass the same authz and audit pipeline as UI/API calls.

## 10. Testing Requirements for API Phase
- Contract tests for every endpoint and error envelope.
- Authz tests for permission boundaries and RLS consistency.
- Idempotency tests for payment create/retry routes.
- Chaos tests for connector timeouts and partial failure handling.
