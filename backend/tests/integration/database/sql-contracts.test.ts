import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), `../supabase/migrations/${name}`), 'utf8');
}

describe('database contract coverage', () => {
  it('keeps transaction imports partitioned and replay-safe', () => {
    const sql = migration('004_transactions.sql');
    expect(sql).toContain('PARTITION BY RANGE (booking_date)');
    expect(sql).toContain('PRIMARY KEY (id, booking_date)');
    expect(sql).toContain('UNIQUE (organization_id, dedupe_hash)');
    expect(sql).toContain('UNIQUE (organization_id, source_system, source_event_id)');
    expect(sql).toContain('Duplicate transaction import detected');
  });

  it('enforces payment idempotency, lifecycle integrity, and optimistic versioning', () => {
    const paymentSql = migration('007_payments.sql');
    const approvalSql = migration('008_approval_workflows.sql');
    expect(paymentSql).toContain('amount numeric(20,6) NOT NULL CHECK (amount > 0)');
    expect(paymentSql).toContain('UNIQUE (organization_id, idempotency_key)');
    expect(paymentSql).toContain('Version is managed by trigger and optimistic lock checks');
    expect(approvalSql).toContain("OLD.status = 'failed' AND NEW.status NOT IN ('failed', 'pending_approval')");
    expect(approvalSql).toContain('approval_workflow_id is required when payment is in approval lifecycle');
  });

  it('captures immutable audit logs through row triggers', () => {
    const sql = migration('013_audit_logs.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.audit_logs');
    expect(sql).toContain('audit_logs are immutable and cannot be');
    expect(sql).toContain("CREATE TRIGGER trg_audit_%I");
    expect(sql).toContain("'payments'");
    expect(sql).toContain("'transactions'");
  });

  it('forces row level security and organization-bound policies across tenant tables', () => {
    const sql = migration('014_rls_policies.sql');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain("'org_member_select'");
    expect(sql).toContain("public.is_org_member(auth.uid(), organization_id)");
    expect(sql).toContain("CREATE POLICY audit_logs_service_all");
    expect(sql).toContain("auth.role() = 'service_role'");
  });

  it('stores encrypted copilot sessions with service-role writes and user-scoped reads', () => {
    const sql = migration('021_copilot_sessions.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.copilot_sessions');
    expect(sql).toContain("messages jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(sql).toContain('token_usage jsonb NOT NULL DEFAULT');
    expect(sql).toContain('ALTER TABLE public.copilot_sessions ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE public.copilot_sessions FORCE ROW LEVEL SECURITY');
    expect(sql).toContain("CREATE POLICY copilot_sessions_user ON public.copilot_sessions");
    expect(sql).toContain('user_id = auth.uid()');
    expect(sql).toContain('CREATE TRIGGER trg_audit_copilot_sessions');
  });

  it('keeps reporting generation anchored in SQL functions and deterministic region mapping', () => {
    const sql = migration('018_reporting_suite.sql');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.country_to_region');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.report_cash_summary');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.report_liquidity');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.report_compliance_package');
  });
});
