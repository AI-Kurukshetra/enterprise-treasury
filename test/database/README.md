# Database Validation Scripts

These scripts validate production-readiness controls for the Supabase Postgres layer.

## Prerequisites

- Supabase CLI installed
- Local stack running (`supabase start`)

## Run All

```bash
for f in test/database/*.sql; do
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f "$f"
done
```

## Scripts

- `01_rls_isolation.sql`: verifies cross-tenant reads are blocked (table + view path)
- `02_constraints_validation.sql`: verifies dedupe/replay/out-of-order/currency/FK constraints
- `03_audit_logging.sql`: verifies audit triggers and immutable audit log behavior
- `04_partition_integrity.sql`: verifies partition auto-hardening (RLS + policy + index + bounds)
