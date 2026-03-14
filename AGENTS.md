# AGENTS.md

Enterprise Treasury & Cash Flow Command Center

This file defines **how Codex agents must operate inside this repository**.

Agents must treat this file as **the operational contract for development**.

If a conflict occurs between instructions:
PRD.md → AGENTS.md → TASKS.md (priority order).

---

# 1. System Mission

This repository builds an **enterprise-grade treasury management platform**.

The platform manages:

* global bank accounts
* payments
* liquidity
* FX exposure
* investments
* debt
* treasury policies
* financial risk analytics

This is **financial infrastructure software**.

Agents must assume:

* **high reliability**
* **high security**
* **auditability**
* **data correctness**

are mandatory.

---

# 2. Core Engineering Principles

All agents must follow these principles.

### 1. Deterministic Systems

Treasury calculations must always produce identical results for the same inputs.

Never introduce nondeterministic behavior in financial calculations.

---

### 2. Financial Accuracy

Never use floating point math for currency calculations.

Always use:

* integer cents
* decimal libraries
* Postgres `numeric`

---

### 3. Auditability

All financial actions must be traceable.

Every mutation must produce:

* audit log entry
* actor id
* timestamp
* change record

---

### 4. Idempotency

All financial APIs must support idempotency.

Example:

```
POST /payments
Idempotency-Key: abc123
```

Duplicate requests must not create duplicate transactions.

---

### 5. Data Integrity

Never allow partial financial writes.

All financial operations must use:

```
database transactions
```

---

# 3. Repository Awareness

Agents must first read:

```
/doc/PRD.md
/doc/TASKS.md
/doc/BLOCKERS.md
/doc/PROGRESS.md
```

Before starting any task.

If `/doc` folder is missing:

Create it and stub required files.

---

# 4. Financial Domain Constraints

This system manages:

* corporate cash
* banking transactions
* investment positions
* FX exposure

Agents must enforce:

### Double-entry accounting model

All transactions must record:

```
debit_account
credit_account
amount
currency
timestamp
```

No single-sided transactions allowed.

---

### Multi-currency normalization

All reporting must support:

```
base_currency
fx_conversion_rate
valuation_timestamp
```

---

### Settlement states

Payments must follow lifecycle:

```
draft
pending_approval
approved
sent_to_bank
settled
failed
cancelled
```

Agents must never bypass state transitions.

---

# 5. Multi-Agent Architecture

Codex runs as **coordinator agent**.

Specialized agents handle tasks.

### Agents

| Agent       | Responsibility        |
| ----------- | --------------------- |
| frontend    | UI, dashboards        |
| backend     | APIs, services        |
| db          | schema and migrations |
| risk-engine | financial analytics   |
| integration | bank APIs             |
| tester      | automated tests       |
| reviewer    | code validation       |

Coordinator must orchestrate.

---

# 6. Development Pipeline

All work must follow pipeline.

```
DB DESIGN
↓
API CONTRACT
↓
SERVICE IMPLEMENTATION
↓
UI IMPLEMENTATION
↓
TESTING
↓
SECURITY REVIEW
```

Agents must never skip layers.

---

# 7. Code Generation Rules

### Backend Rules

Use:

```
NestJS
TypeScript
Prisma
PostgreSQL
Redis
```

Never generate:

```
Express.js
MongoDB
untyped JavaScript
```

---

### Frontend Rules

Use:

```
Next.js App Router
React Server Components
Tailwind
shadcn/ui
```

Never generate:

```
CSS frameworks
class components
Redux
```

---

# 8. Financial Safety Rules

Agents must implement:

### Idempotent Payments

Payment APIs must store:

```
idempotency_key
request_hash
```

Reject duplicates.

---

### Ledger Consistency

Ledger must balance:

```
sum(debits) = sum(credits)
```

Reject transaction if not balanced.

---

### FX Handling

Store FX rates with timestamp.

Never apply:

```
floating exchange rates without snapshot
```

---

# 9. Security Standards

Agents must enforce:

### Authentication

JWT + Supabase Auth.

---

### Authorization

RBAC roles:

```
admin
treasurer
analyst
auditor
```

---

### Audit Logs

All operations must write to:

```
audit_logs
```

Fields:

```
actor_id
action
entity
entity_id
before
after
timestamp
```

---

# 10. Treasury Calculations

Agents must centralize financial calculations.

Create modules:

```
/lib/finance
/lib/fx
/lib/liquidity
```

No UI or API code may perform financial math.

---

# 11. Bank Integration Standards

Bank integrations must be abstracted.

```
/integrations/banks/
```

Adapters:

```
swift
openbanking
host2host
mt940
```

Never mix bank logic into core services.

---

# 12. Observability

All services must emit:

```
structured logs
metrics
traces
```

Use:

```
OpenTelemetry
Prometheus
```

---

# 13. Testing Requirements

Agents must create tests for:

### Unit Tests

* financial math
* FX conversion
* policy engine
* forecasting

---

### Integration Tests

* payment flows
* bank integrations
* ledger posting

---

### E2E Tests

* payment approval
* dashboard views
* forecasting reports

---

# 14. Performance Targets

System must support:

```
10k transactions/sec
500k bank accounts
100M transactions
```

Agents must avoid:

* synchronous blocking operations
* unindexed queries
* N+1 queries

---

# 15. Database Requirements

Tables must include:

```
created_at
updated_at
deleted_at
created_by
updated_by
```

All financial tables must include:

```
transaction_id
currency
amount
```

---

# 16. Edge Cases Agents Must Handle

Agents must implement logic for:

### Payment duplication

Prevent duplicate payment submission.

---

### Bank outages

Queue payments for retry.

---

### FX rate unavailability

Fallback to last valid rate.

---

### Partial bank statement imports

Ensure reconciliation tolerates partial data.

---

### Time zone mismatches

Normalize timestamps to UTC.

---

# 17. AI-Specific Rules

When generating code agents must:

1. prefer deterministic logic
2. produce testable modules
3. avoid speculative features
4. follow PRD strictly

Agents must never:

* invent APIs not in PRD
* fabricate banking protocols
* ignore edge cases

---

# 18. Documentation Responsibilities

Agents must update:

```
/doc/TASKS.md
/doc/PROGRESS.md
/doc/CHANGELOG.md
/doc/DECISIONS.md
/doc/SCHEMA.md
```

after completing tasks.

---

# 19. Blocking Conditions

Agents must stop and write to:

```
/doc/BLOCKERS.md
```

when encountering:

* unclear financial logic
* missing bank specification
* schema conflicts
* security ambiguity

---

# 20. What Agents Must NEVER Do

Agents must never:

* generate financial logic without tests
* bypass approval workflows
* write raw SQL without migrations
* commit secrets
* use floating-point currency math
* disable RLS in Supabase
* hardcode exchange rates
* skip audit logging
* create silent failure paths

---

# 21. Commit Protocol

Agents must commit using:

```
Conventional commits
```

Example:

```
feat(payments): implement payment approval workflow
fix(ledger): enforce double-entry validation
```

---

# 22. Task Completion Protocol

When finishing a task:

1. mark `[x]` in TASKS.md
2. log entry in PROGRESS.md
3. update CHANGELOG.md
4. update SCHEMA.md if schema changed
5. write decision to DECISIONS.md

---

# 23. Escalation

Agents must escalate when:

* treasury rules unclear
* banking protocol unknown
* schema conflict detected

Never guess.

---

# 24. Final Instruction

Agents must behave as:

```
Senior Fintech Engineers
```

not generic code generators.

Accuracy, safety, and auditability take priority over speed.
