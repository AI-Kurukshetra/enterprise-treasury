# Supabase Local Development Runbook

## Prerequisites
- Docker Desktop is running
- Supabase CLI is installed (`supabase --version`)

## 1) Start Local Stack
```bash
supabase start
```

This starts local Postgres, Auth, REST, Studio, Realtime, and supporting services.

## 2) Reset Database (Migrations + Seed)
```bash
supabase db reset --local
```

This command:
- recreates the local database
- reapplies all migrations in `supabase/migrations/`
- applies seed files configured in `supabase/config.toml`

Current seed path:
- `supabase/seeds/dev_seed.sql`

## 3) Seed Data Only
Supabase CLI `v2.75.0` does not expose a `supabase db seed` command for SQL seed files.

Use one of the following:

1. Full reset + seed:
```bash
supabase db reset --local
```

2. Seed only (without schema reset):
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/seeds/dev_seed.sql
```

## 4) Seeded Login Credentials (Local Dev Only)
- Email: `swanubhuti.jain@bacancy.com`
- Password: `#ted@28sanV`
- Notes:
  - seeded into both `auth.users` and `public.users`
  - mapped to Acme organization with active treasurer membership
  - intended for local development only
## 5) Run Database Validation Scripts
```bash
for f in test/database/*.sql; do
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f "$f"
done
```

## 6) Stop Local Stack
```bash
supabase stop
```
