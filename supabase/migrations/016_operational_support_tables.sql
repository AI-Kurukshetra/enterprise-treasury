BEGIN;

CREATE TABLE IF NOT EXISTS public.treasury_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_name text NOT NULL CHECK (length(trim(policy_name)) > 0),
  policy_type text NOT NULL CHECK (length(trim(policy_type)) > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_treasury_policies_effective_window
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  UNIQUE (organization_id, policy_name, version),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.compliance_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (length(trim(report_type)) > 0),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'generated', 'approved', 'filed')),
  artifact_uri text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_compliance_reports_period CHECK (period_end >= period_start),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.integration_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration_type text NOT NULL CHECK (length(trim(integration_type)) > 0),
  direction text NOT NULL CHECK (direction IN ('import', 'export')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'partial')),
  started_at timestamptz,
  completed_at timestamptz,
  error_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_treasury_policies_org_type_active
  ON public.treasury_policies (organization_id, policy_type, is_active, effective_from DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_reports_org_period
  ON public.compliance_reports (organization_id, period_start DESC, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_integration_sync_jobs_org_created
  ON public.integration_sync_jobs (organization_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_treasury_policies_set_updated_at ON public.treasury_policies;
CREATE TRIGGER trg_treasury_policies_set_updated_at
BEFORE UPDATE ON public.treasury_policies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_compliance_reports_set_updated_at ON public.compliance_reports;
CREATE TRIGGER trg_compliance_reports_set_updated_at
BEFORE UPDATE ON public.compliance_reports
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_integration_sync_jobs_set_updated_at ON public.integration_sync_jobs;
CREATE TRIGGER trg_integration_sync_jobs_set_updated_at
BEFORE UPDATE ON public.integration_sync_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.treasury_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON public.treasury_policies;
DROP POLICY IF EXISTS org_member_select ON public.treasury_policies;
DROP POLICY IF EXISTS org_member_insert ON public.treasury_policies;
DROP POLICY IF EXISTS org_member_update ON public.treasury_policies;
DROP POLICY IF EXISTS org_member_delete ON public.treasury_policies;

CREATE POLICY service_role_all ON public.treasury_policies
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY org_member_select ON public.treasury_policies
  FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_insert ON public.treasury_policies
  FOR INSERT
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_update ON public.treasury_policies
  FOR UPDATE
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_delete ON public.treasury_policies
  FOR DELETE
  USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS service_role_all ON public.compliance_reports;
DROP POLICY IF EXISTS org_member_select ON public.compliance_reports;
DROP POLICY IF EXISTS org_member_insert ON public.compliance_reports;
DROP POLICY IF EXISTS org_member_update ON public.compliance_reports;
DROP POLICY IF EXISTS org_member_delete ON public.compliance_reports;

CREATE POLICY service_role_all ON public.compliance_reports
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY org_member_select ON public.compliance_reports
  FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_insert ON public.compliance_reports
  FOR INSERT
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_update ON public.compliance_reports
  FOR UPDATE
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_delete ON public.compliance_reports
  FOR DELETE
  USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS service_role_all ON public.integration_sync_jobs;
DROP POLICY IF EXISTS org_member_select ON public.integration_sync_jobs;
DROP POLICY IF EXISTS org_member_insert ON public.integration_sync_jobs;
DROP POLICY IF EXISTS org_member_update ON public.integration_sync_jobs;
DROP POLICY IF EXISTS org_member_delete ON public.integration_sync_jobs;

CREATE POLICY service_role_all ON public.integration_sync_jobs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY org_member_select ON public.integration_sync_jobs
  FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_insert ON public.integration_sync_jobs
  FOR INSERT
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_update ON public.integration_sync_jobs
  FOR UPDATE
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY org_member_delete ON public.integration_sync_jobs
  FOR DELETE
  USING (public.is_org_member(auth.uid(), organization_id));

DROP TRIGGER IF EXISTS trg_audit_treasury_policies ON public.treasury_policies;
CREATE TRIGGER trg_audit_treasury_policies
AFTER INSERT OR UPDATE OR DELETE ON public.treasury_policies
FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log_from_row();

DROP TRIGGER IF EXISTS trg_audit_compliance_reports ON public.compliance_reports;
CREATE TRIGGER trg_audit_compliance_reports
AFTER INSERT OR UPDATE OR DELETE ON public.compliance_reports
FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log_from_row();

DROP TRIGGER IF EXISTS trg_audit_integration_sync_jobs ON public.integration_sync_jobs;
CREATE TRIGGER trg_audit_integration_sync_jobs
AFTER INSERT OR UPDATE OR DELETE ON public.integration_sync_jobs
FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log_from_row();

COMMIT;
