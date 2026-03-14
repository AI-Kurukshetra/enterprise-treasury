# Atlas Treasury

**Enterprise Treasury & Cash Flow Management Platform**

A cloud-native treasury management platform for mid-to-large enterprises. Manage liquidity, financial risk, bank relationships, and cash operations across multiple subsidiaries, currencies, and banking partners.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS, TanStack Query, Recharts |
| Backend | Next.js 15 API Routes (port 3001), Zod validation |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Auth | Supabase Auth (cookie-based SSR sessions) |

---

## Project Structure

```
enterprise/
├── frontend/          # Next.js 15 app (port 3000)
├── backend/           # Next.js API server (port 3001)
├── supabase/
│   ├── migrations/    # Database schema migrations
│   └── seeds/         # Dev seed data
├── docs/              # Architecture, API spec, schema docs
└── infrastructure/    # Deployment config
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- A Supabase project (or local Supabase CLI)

### 1. Environment Setup

Copy the example env files and fill in your Supabase credentials:

```bash
cp frontend/.env.local.example frontend/.env.local
cp backend/.env.local.example backend/.env.local
```

### 2. Run Database Migrations

Apply all migrations in order via the Supabase SQL Editor or CLI:

```bash
supabase db push
```

### 3. Seed Dev Data

In the Supabase SQL Editor, open `supabase/seeds/dev_seed.sql`.

Before running, replace the password placeholder:
```sql
-- Find: REPLACE_WITH_DEV_PASSWORD
-- Replace with your actual dev password
```

Then run the seed. The seed creates two organisations (Acme Treasury Corp and Globex Finance Ltd) with bank accounts, transactions, payments, cash positions, and currency rates.

### 4. Start the Servers

Open two terminals:

```bash
# Terminal 1 — Frontend (http://localhost:3000)
npm run dev:frontend

# Terminal 2 — Backend API (http://localhost:3001)
npm run dev:backend
```

Or start just the frontend (if backend is already running):

```bash
npm run dev
```

---

## Key Features

- **Real-time cash visibility** — global cash positions across accounts, entities, and currencies
- **Payment workflow** — create, approve, and track payments with multi-step approval chains
- **Bank integrations** — Open Banking, SFTP, and manual file import
- **FX risk management** — exposure tracking, hedging instruments, currency rate feeds
- **AI-powered forecasting** — cash flow forecasts with statistical and AI-hybrid models
- **Liquidity management** — pool structures, sweeping rules, intercompany transactions
- **Debt & investment tracking** — facilities, schedules, money market funds, bonds
- **Treasury Copilot** — AI assistant for treasury queries and analysis
- **Audit & compliance** — full audit log, policy enforcement, role-based access control

---

## Documentation

| Doc | Description |
|---|---|
| [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) | Architecture overview |
| [docs/SCHEMA.md](docs/SCHEMA.md) | Database schema and RLS strategy |
| [docs/API_SPEC.md](docs/API_SPEC.md) | API contract and endpoints |
| [docs/PRD.md](docs/PRD.md) | Product requirements |
| [docs/SUPABASE_LOCAL_DEV.md](docs/SUPABASE_LOCAL_DEV.md) | Local Supabase setup guide |

---

## Development

```bash
# Type checking
npm run typecheck:frontend

# Backend tests
npm test

# Backend test coverage
npm run test:coverage

# E2E tests
npm run test:e2e
```
