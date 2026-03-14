# AI Engineering Skills Configuration

This file defines the **skills, frameworks, and engineering standards** that Codex must follow while developing this project.

The system is an **Enterprise Treasury & Cash Flow Command Center** for enterprise fintech use.

Codex must behave like a **senior full-stack engineering team** using these capabilities.

---

# Core Engineering Skills

## Software Architecture

Use:

* Clean Architecture
* Domain Driven Design (DDD)
* Service Layer Pattern
* Repository Pattern

All business logic must live in **services**.

API routes must remain thin.

---

# Backend Engineering

Stack:

* Next.js (App Router)
* TypeScript (strict)
* Supabase
* Zod

Rules:

* No `any` types
* Full schema validation
* Modular service architecture
* Repository pattern for database access

Security rules:

* enforce organization_id isolation
* never expose service role keys
* implement idempotency for payments

---

# Database Engineering

Use PostgreSQL best practices.

Rules:

* NUMERIC(20,6) for monetary values
* UUID primary keys
* strict foreign keys
* RLS policies for multi-tenancy

Indexes required for:

* transaction queries
* bank accounts
* payment workflows

---

# API Design

Follow RESTful API standards.

Example:

```
/api/v1/accounts
/api/v1/transactions
/api/v1/payments
```

Rules:

* request validation
* response validation
* structured errors
* consistent status codes

---

# Frontend Development

Use modern UI best practices.

Framework:

* Next.js
* React
* Tailwind
* shadcn/ui

Design principles:

* enterprise dashboards
* high data density
* responsive layouts
* accessibility compliant

Use skills from:

https://skills.sh/frontend-design

Focus on:

* dashboard layouts
* financial data tables
* charts and analytics

---

# Testing Skills

Use:

Vitest
Supertest
Playwright

Coverage target:

70%+

Test:

* services
* repositories
* APIs
* payment workflows
* approval flows

---

# Security Skills

FinTech security practices must be applied.

Protect against:

* replay attacks
* cross-tenant access
* payment duplication
* API abuse

Audit logs must be implemented.

---

# Observability

Implement:

* structured logging
* metrics
* tracing

Use patterns from enterprise systems.

---

# AI Development Skills

Use AI to implement:

* forecasting algorithms
* liquidity analysis
* financial insights
* natural language treasury queries

Use MCP servers where applicable.

---

# Performance Engineering

Ensure scalability for:

* millions of transactions
* real-time dashboards
* concurrent payment processing

Use:

* caching
* indexed queries
* async processing

---

# Documentation Discipline

Whenever architecture decisions change:

Update:

docs/PROGRESS.md
docs/TASKS.md
docs/CHANGELOG.md
docs/DECISIONS.md

Documentation must stay synchronized with code.

---

# Development Philosophy

Codex must act as:

* staff backend engineer
* senior database engineer
* AI systems engineer
* QA automation engineer
* security auditor

The goal is to build a **production-grade enterprise treasury platform** exceeding modern treasury software capabilities.
