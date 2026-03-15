BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. notifications table — drop partial table and recreate cleanly
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.notifications CASCADE;

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (length(trim(type)) > 0),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'success')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  body text NOT NULL,
  action_url text,
  action_label text,
  related_entity_type text,
  related_entity_id uuid,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  deleted_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_org_user_unread
  ON public.notifications (organization_id, user_id, is_read)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_org_created
  ON public.notifications (organization_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_service_role ON public.notifications;
CREATE POLICY notifications_service_role ON public.notifications
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT USING (
    deleted_at IS NULL
    AND organization_id IN (
      SELECT om.organization_id FROM public.organization_memberships om
      WHERE om.user_id = auth.uid() AND om.status = 'active'
    )
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE USING (user_id = auth.uid() AND deleted_at IS NULL);

DROP TRIGGER IF EXISTS trg_notifications_set_updated_at ON public.notifications;
CREATE TRIGGER trg_notifications_set_updated_at
BEFORE UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. sweeping_rules — add rule_name column (backend repository requires it)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sweeping_rules
  ADD COLUMN IF NOT EXISTS rule_name text;

-- back-fill existing rows with a generated name
UPDATE public.sweeping_rules
SET rule_name = 'Rule-' || substring(id::text, 1, 8)
WHERE rule_name IS NULL;

ALTER TABLE public.sweeping_rules
  ALTER COLUMN rule_name SET NOT NULL;

ALTER TABLE public.sweeping_rules
  DROP CONSTRAINT IF EXISTS chk_sweeping_rules_rule_name;
ALTER TABLE public.sweeping_rules
  ADD CONSTRAINT chk_sweeping_rules_rule_name CHECK (length(trim(rule_name)) > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. sweeping_rules — add max_transfer column if missing
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sweeping_rules
  ADD COLUMN IF NOT EXISTS max_transfer numeric(20,6);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Missing role permissions for treasurer role
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL session_replication_role = 'replica';  -- bypass RLS + triggers for seed inserts

INSERT INTO public.role_permissions (id, organization_id, role_id, permission_key)
VALUES
  -- admin
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'admin.roles.read'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'admin.users.read'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'admin.audit.read'),
  -- reports
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'reports.read'),
  -- fx
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'fx.read'),
  -- risk
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'risk.read'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'risk.write'),
  -- investments
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'investments.read'),
  -- debt
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'debt.read'),
  -- forecasts
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'forecasts.read'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'forecasts.write'),
  -- transactions
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'transactions.read'),
  -- accounts
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'accounts.read'),
  -- integrations
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'integrations.read'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'integrations.write')
ON CONFLICT (organization_id, role_id, permission_key) DO NOTHING;

COMMIT;
