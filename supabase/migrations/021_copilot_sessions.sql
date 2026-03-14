BEGIN;

CREATE TABLE IF NOT EXISTS public.copilot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  token_usage jsonb NOT NULL DEFAULT jsonb_build_object(
    'inputTokens', 0,
    'outputTokens', 0,
    'cacheCreationInputTokens', 0,
    'cacheReadInputTokens', 0,
    'estimatedCostUsd', '0.000000'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_copilot_sessions_org_user_updated
  ON public.copilot_sessions (organization_id, user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_copilot_sessions_user_updated
  ON public.copilot_sessions (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS trg_copilot_sessions_set_updated_at ON public.copilot_sessions;
CREATE TRIGGER trg_copilot_sessions_set_updated_at
BEFORE UPDATE ON public.copilot_sessions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.copilot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS copilot_sessions_service_all ON public.copilot_sessions;
CREATE POLICY copilot_sessions_service_all ON public.copilot_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS copilot_sessions_user ON public.copilot_sessions;
CREATE POLICY copilot_sessions_user ON public.copilot_sessions
  FOR SELECT
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS trg_audit_copilot_sessions ON public.copilot_sessions;
CREATE TRIGGER trg_audit_copilot_sessions
AFTER INSERT OR UPDATE OR DELETE ON public.copilot_sessions
FOR EACH ROW EXECUTE FUNCTION public.capture_audit_log_from_row();

COMMIT;
