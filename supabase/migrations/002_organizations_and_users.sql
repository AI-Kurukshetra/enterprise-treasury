BEGIN;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  base_currency public.currency_code NOT NULL,
  status public.organization_status_enum NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY,
  email citext NOT NULL UNIQUE,
  display_name text,
  mfa_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_id uuid NOT NULL,
  permission_key text NOT NULL CHECK (length(trim(permission_key)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_role_permissions_role_org
    FOREIGN KEY (role_id, organization_id)
    REFERENCES public.roles (id, organization_id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL,
  status public.membership_status_enum NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_memberships_role_org
    FOREIGN KEY (role_id, organization_id)
    REFERENCES public.roles (id, organization_id)
    ON DELETE RESTRICT,
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_id
  ON public.organization_memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_memberships_org_status
  ON public.organization_memberships (organization_id, status);

CREATE OR REPLACE FUNCTION public.is_org_member(p_user_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.user_id = p_user_id
      AND om.organization_id = p_org_id
      AND om.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_org_permission(
  p_user_id uuid,
  p_org_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    JOIN public.role_permissions rp
      ON rp.role_id = om.role_id
     AND rp.organization_id = om.organization_id
    WHERE om.user_id = p_user_id
      AND om.organization_id = p_org_id
      AND om.status = 'active'
      AND rp.permission_key = p_permission_key
  );
$$;

DROP TRIGGER IF EXISTS trg_organizations_set_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_set_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON public.users;
CREATE TRIGGER trg_users_set_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_roles_set_updated_at ON public.roles;
CREATE TRIGGER trg_roles_set_updated_at
BEFORE UPDATE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_role_permissions_set_updated_at ON public.role_permissions;
CREATE TRIGGER trg_role_permissions_set_updated_at
BEFORE UPDATE ON public.role_permissions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_memberships_set_updated_at ON public.organization_memberships;
CREATE TRIGGER trg_memberships_set_updated_at
BEFORE UPDATE ON public.organization_memberships
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
