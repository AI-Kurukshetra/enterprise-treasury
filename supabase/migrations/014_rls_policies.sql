BEGIN;

DO $$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT t.tablename AS table_name
    FROM pg_tables t
    WHERE t.schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table.table_name);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS organizations_select ON public.organizations;
DROP POLICY IF EXISTS organizations_insert ON public.organizations;
DROP POLICY IF EXISTS organizations_update ON public.organizations;
DROP POLICY IF EXISTS organizations_delete ON public.organizations;

CREATE POLICY organizations_select ON public.organizations
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR public.is_org_member(auth.uid(), id)
  );

CREATE POLICY organizations_insert ON public.organizations
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY organizations_update ON public.organizations
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY organizations_delete ON public.organizations
  FOR DELETE
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS users_select ON public.users;
DROP POLICY IF EXISTS users_insert ON public.users;
DROP POLICY IF EXISTS users_update ON public.users;
DROP POLICY IF EXISTS users_delete ON public.users;

CREATE POLICY users_select ON public.users
  FOR SELECT
  USING (auth.role() = 'service_role' OR id = auth.uid());

CREATE POLICY users_insert ON public.users
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR id = auth.uid());

CREATE POLICY users_update ON public.users
  FOR UPDATE
  USING (auth.role() = 'service_role' OR id = auth.uid())
  WITH CHECK (auth.role() = 'service_role' OR id = auth.uid());

CREATE POLICY users_delete ON public.users
  FOR DELETE
  USING (auth.role() = 'service_role');

DO $$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name = 'organization_id'
      AND c.table_name NOT IN ('organizations', 'audit_logs')
    GROUP BY c.table_name
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'service_role_all', v_table.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_member_select', v_table.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_member_insert', v_table.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_member_update', v_table.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_member_delete', v_table.table_name);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      'service_role_all',
      v_table.table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_org_member(auth.uid(), organization_id))',
      'org_member_select',
      v_table.table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.is_org_member(auth.uid(), organization_id))',
      'org_member_insert',
      v_table.table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (public.is_org_member(auth.uid(), organization_id)) WITH CHECK (public.is_org_member(auth.uid(), organization_id))',
      'org_member_update',
      v_table.table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING (public.is_org_member(auth.uid(), organization_id))',
      'org_member_delete',
      v_table.table_name
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS audit_logs_service_all ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_member_select ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_service_insert ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_no_update ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_no_delete ON public.audit_logs;

CREATE POLICY audit_logs_service_all ON public.audit_logs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY audit_logs_member_select ON public.audit_logs
  FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY audit_logs_service_insert ON public.audit_logs
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
