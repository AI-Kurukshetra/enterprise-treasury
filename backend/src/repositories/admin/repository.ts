import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { PolicyRule } from '@/lib/policy-engine/policy-types';
import { unwrapPolicyRules, wrapPolicyRules } from '@/lib/policy-engine/policy-types';

interface MembershipRow {
  user_id: string;
  role_id: string;
  status: 'active' | 'invited' | 'revoked';
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  mfa_enabled: boolean;
}

interface RoleRow {
  id: string;
  name: string;
  is_system: boolean;
}

interface RolePermissionRow {
  role_id: string;
  permission_key: string;
}

interface PolicyRow {
  id: string;
  policy_name: string;
  policy_type: string;
  version: number;
  rules: unknown;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
}

export interface AdminUserRecord {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: 'active' | 'invited' | 'revoked';
  lastLogin: string | null;
  mfaEnabled: boolean;
}

export interface AdminRoleRecord {
  id: string;
  name: string;
  isSystem: boolean;
  permissionCount: number;
  permissions: string[];
}

export interface TreasuryPolicyRecord {
  id: string;
  name: string;
  domain: string;
  version: number;
  rules: PolicyRule[];
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAuditLogRecord {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: string;
}

export interface AdminAuditLogFilters {
  fromDate?: string;
  toDate?: string;
  userId?: string;
  action?: string;
  entityType?: string;
  search?: string;
  limit: number;
  cursor?: string;
}

export class AdminRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async listUsers(): Promise<AdminUserRecord[]> {
    const { data: memberships, error: membershipError } = await this.db
      .from('organization_memberships')
      .select('user_id,role_id,status')
      .eq('organization_id', this.context.organizationId)
      .order('created_at', { ascending: true });

    assertNoQueryError(membershipError);

    const membershipRows = (memberships ?? []) as MembershipRow[];
    if (membershipRows.length === 0) {
      return [];
    }

    const userIds = Array.from(new Set(membershipRows.map((membership) => membership.user_id)));
    const roleIds = Array.from(new Set(membershipRows.map((membership) => membership.role_id)));

    const [{ data: users, error: usersError }, { data: roles, error: rolesError }, { data: activity, error: activityError }] =
      await Promise.all([
        this.db.from('users').select('id,email,display_name,mfa_enabled').in('id', userIds),
        this.db.from('roles').select('id,name,is_system').eq('organization_id', this.context.organizationId).in('id', roleIds),
        this.db
          .from('audit_logs')
          .select('user_id,created_at')
          .eq('organization_id', this.context.organizationId)
          .in('user_id', userIds)
          .order('created_at', { ascending: false })
      ]);

    assertNoQueryError(usersError);
    assertNoQueryError(rolesError);
    assertNoQueryError(activityError);

    const usersById = new Map(((users ?? []) as UserRow[]).map((user) => [user.id, user]));
    const rolesById = new Map(((roles ?? []) as RoleRow[]).map((role) => [role.id, role.name]));
    const lastActivityByUserId = new Map<string, string>();

    for (const row of (activity ?? []) as Array<{ user_id: string | null; created_at: string }>) {
      if (row.user_id && !lastActivityByUserId.has(row.user_id)) {
        lastActivityByUserId.set(row.user_id, row.created_at);
      }
    }

    return membershipRows
      .map((membership) => {
        const user = usersById.get(membership.user_id);
        if (!user) {
          return null;
        }

        return {
          id: user.id,
          name: user.display_name,
          email: user.email,
          role: rolesById.get(membership.role_id) ?? 'Unknown role',
          status: membership.status,
          lastLogin: lastActivityByUserId.get(user.id) ?? null,
          mfaEnabled: user.mfa_enabled
        };
      })
      .filter((row): row is AdminUserRecord => row !== null);
  }

  async revokeUser(userId: string): Promise<{ userId: string; status: 'revoked' }> {
    const { error } = await this.db
      .from('organization_memberships')
      .update({ status: 'revoked' })
      .eq('organization_id', this.context.organizationId)
      .eq('user_id', userId);

    assertNoQueryError(error);
    return { userId, status: 'revoked' };
  }

  async createRole(name: string, permissions: string[]): Promise<{ roleId: string; name: string }> {
    const { data: role, error: roleError } = await this.db
      .from('roles')
      .insert({
        organization_id: this.context.organizationId,
        name,
        is_system: false
      })
      .select('id,name')
      .single();

    assertNoQueryError(roleError);

    const roleId = (role as { id: string; name: string }).id;
    const uniquePermissions = Array.from(new Set(permissions));
    const { error: permissionsError } = await this.db.from('role_permissions').insert(
      uniquePermissions.map((permission) => ({
        organization_id: this.context.organizationId,
        role_id: roleId,
        permission_key: permission
      }))
    );

    assertNoQueryError(permissionsError);
    return {
      roleId,
      name: (role as { id: string; name: string }).name
    };
  }

  async listRoles(): Promise<AdminRoleRecord[]> {
    const [{ data: roles, error: rolesError }, { data: permissions, error: permissionsError }] = await Promise.all([
      this.db
        .from('roles')
        .select('id,name,is_system')
        .eq('organization_id', this.context.organizationId)
        .order('name', { ascending: true }),
      this.db
        .from('role_permissions')
        .select('role_id,permission_key')
        .eq('organization_id', this.context.organizationId)
        .order('permission_key', { ascending: true })
    ]);

    assertNoQueryError(rolesError);
    assertNoQueryError(permissionsError);

    const permissionsByRole = new Map<string, string[]>();
    for (const row of (permissions ?? []) as RolePermissionRow[]) {
      const existing = permissionsByRole.get(row.role_id) ?? [];
      existing.push(row.permission_key);
      permissionsByRole.set(row.role_id, existing);
    }

    return ((roles ?? []) as RoleRow[]).map((role) => {
      const permissionKeys = permissionsByRole.get(role.id) ?? [];
      return {
        id: role.id,
        name: role.name,
        isSystem: role.is_system,
        permissionCount: permissionKeys.length,
        permissions: permissionKeys
      };
    });
  }

  async createPolicy(input: {
    name: string;
    domain: string;
    rules: PolicyRule[];
    createdBy: string;
    isActive?: boolean;
    effectiveFrom?: string;
    effectiveTo?: string | null;
  }): Promise<TreasuryPolicyRecord> {
    const { data, error } = await this.db
      .from('treasury_policies')
      .insert({
        organization_id: this.context.organizationId,
        policy_name: input.name,
        policy_type: input.domain,
        rules: wrapPolicyRules(input.rules),
        is_active: input.isActive ?? false,
        effective_from: input.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        effective_to: input.effectiveTo ?? null,
        created_by: input.createdBy
      })
      .select('id,policy_name,policy_type,version,rules,is_active,effective_from,effective_to,created_at,updated_at')
      .single();

    assertNoQueryError(error);
    return this.mapPolicyRow(data as PolicyRow);
  }

  async updatePolicy(input: {
    policyId: string;
    name?: string;
    domain?: string;
    rules: PolicyRule[];
    isActive?: boolean;
    effectiveFrom?: string;
    effectiveTo?: string | null;
  }): Promise<TreasuryPolicyRecord> {
    const payload: Record<string, unknown> = {
      rules: wrapPolicyRules(input.rules)
    };

    if (input.name) {
      payload.policy_name = input.name;
    }
    if (input.domain) {
      payload.policy_type = input.domain;
    }
    if (typeof input.isActive === 'boolean') {
      payload.is_active = input.isActive;
    }
    if (input.effectiveFrom) {
      payload.effective_from = input.effectiveFrom;
    }
    if (input.effectiveTo !== undefined) {
      payload.effective_to = input.effectiveTo ?? null;
    }

    const { data, error } = await this.db
      .from('treasury_policies')
      .update(payload)
      .eq('organization_id', this.context.organizationId)
      .eq('id', input.policyId)
      .select('id,policy_name,policy_type,version,rules,is_active,effective_from,effective_to,created_at,updated_at')
      .single();

    assertNoQueryError(error);
    return this.mapPolicyRow(data as PolicyRow);
  }

  async getPolicy(policyId: string): Promise<TreasuryPolicyRecord | null> {
    const { data, error } = await this.db
      .from('treasury_policies')
      .select('id,policy_name,policy_type,version,rules,is_active,effective_from,effective_to,created_at,updated_at')
      .eq('organization_id', this.context.organizationId)
      .eq('id', policyId)
      .maybeSingle();

    assertNoQueryError(error);
    return data ? this.mapPolicyRow(data as PolicyRow) : null;
  }

  async activatePolicy(policyId: string, effectiveFrom: string): Promise<TreasuryPolicyRecord> {
    const { data, error } = await this.db
      .from('treasury_policies')
      .update({
        is_active: true,
        effective_from: effectiveFrom,
        effective_to: null
      })
      .eq('organization_id', this.context.organizationId)
      .eq('id', policyId)
      .select('id,policy_name,policy_type,version,rules,is_active,effective_from,effective_to,created_at,updated_at')
      .single();

    assertNoQueryError(error);
    return this.mapPolicyRow(data as PolicyRow);
  }

  async deactivatePolicy(policyId: string, effectiveTo: string): Promise<TreasuryPolicyRecord> {
    const { data, error } = await this.db
      .from('treasury_policies')
      .update({
        is_active: false,
        effective_to: effectiveTo
      })
      .eq('organization_id', this.context.organizationId)
      .eq('id', policyId)
      .select('id,policy_name,policy_type,version,rules,is_active,effective_from,effective_to,created_at,updated_at')
      .single();

    assertNoQueryError(error);
    return this.mapPolicyRow(data as PolicyRow);
  }

  async listPolicies(domain?: string): Promise<TreasuryPolicyRecord[]> {
    let query = this.db
      .from('treasury_policies')
      .select('id,policy_name,policy_type,version,rules,is_active,effective_from,effective_to,created_at,updated_at')
      .eq('organization_id', this.context.organizationId);

    if (domain) {
      query = query.eq('policy_type', domain);
    }

    const { data, error } = await query.order('effective_from', { ascending: false });

    assertNoQueryError(error);
    return ((data ?? []) as PolicyRow[]).map((row) => this.mapPolicyRow(row));
  }

  async listAuditLogs(
    filters: AdminAuditLogFilters
  ): Promise<{ items: AdminAuditLogRecord[]; nextCursor: string | null }> {
    let query = this.db
      .from('audit_logs')
      .select('id,user_id,action,entity_type,entity_id,previous_state,new_state,request_id,created_at')
      .eq('organization_id', this.context.organizationId)
      .order('created_at', { ascending: false })
      .limit(filters.limit + 1);

    if (filters.fromDate) {
      query = query.gte('created_at', `${filters.fromDate}T00:00:00.000Z`);
    }

    if (filters.toDate) {
      query = query.lte('created_at', `${filters.toDate}T23:59:59.999Z`);
    }

    if (filters.userId) {
      query = query.eq('user_id', filters.userId);
    }

    if (filters.action) {
      query = query.eq('action', filters.action);
    }

    if (filters.entityType) {
      query = query.eq('entity_type', filters.entityType);
    }

    if (filters.search) {
      const search = filters.search.replace(/[%_,]/g, ' ').trim();
      if (search) {
        query = query.or(
          `action.ilike.%${search}%,entity_type.ilike.%${search}%,request_id.ilike.%${search}%`
        );
      }
    }

    if (filters.cursor) {
      query = query.lt('created_at', filters.cursor);
    }

    const { data, error } = await query;
    assertNoQueryError(error);

    const rows = (data ?? []) as AuditLogRow[];
    const pageRows = rows.slice(0, filters.limit);
    const nextCursor = rows.length > filters.limit ? pageRows.at(-1)?.created_at ?? null : null;
    const userIds = Array.from(new Set(pageRows.map((row) => row.user_id).filter((value): value is string => Boolean(value))));

    const { data: users, error: usersError } = userIds.length
      ? await this.db.from('users').select('id,email').in('id', userIds)
      : { data: [], error: null };

    assertNoQueryError(usersError);
    const usersById = new Map(((users ?? []) as Array<{ id: string; email: string }>).map((user) => [user.id, user.email]));

    return {
      items: pageRows.map((log) => ({
        id: log.id,
        userId: log.user_id,
        userEmail: log.user_id ? (usersById.get(log.user_id) ?? null) : null,
        action: log.action,
        entityType: log.entity_type,
        entityId: log.entity_id,
        previousState: log.previous_state,
        newState: log.new_state,
        requestId: log.request_id,
        createdAt: log.created_at
      })),
      nextCursor
    };
  }

  private mapPolicyRow(row: PolicyRow): TreasuryPolicyRecord {
    return {
      id: row.id,
      name: row.policy_name,
      domain: row.policy_type,
      version: row.version,
      rules: unwrapPolicyRules(row.rules),
      isActive: row.is_active,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
