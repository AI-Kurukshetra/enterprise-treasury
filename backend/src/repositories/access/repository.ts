import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AuthenticationError } from '@/errors/AuthenticationError';
import { createAnonSupabaseClient, createServiceSupabaseClient } from '@/lib/supabase';
import { assertNoQueryError } from '@/repositories/base/execute';

export class AccessRepository {
  private readonly anonClient: SupabaseClient;
  private readonly serviceClient: SupabaseClient;

  constructor(anonClient?: SupabaseClient, serviceClient?: SupabaseClient) {
    this.anonClient = anonClient ?? createAnonSupabaseClient();
    this.serviceClient = serviceClient ?? createServiceSupabaseClient();
  }

  async authenticate(token: string): Promise<User> {
    const { data, error } = await this.anonClient.auth.getUser(token);
    if (error || !data.user) {
      throw new AuthenticationError('Invalid or expired token');
    }
    return data.user;
  }

  async signIn(email: string, password: string): Promise<{ user: User; session: { access_token: string; expires_in: number | null } }> {
    const { data, error } = await this.anonClient.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.user || !data.session) {
      throw new AuthenticationError('Invalid email or password');
    }

    return {
      user: data.user,
      session: {
        access_token: data.session.access_token,
        expires_in: data.session.expires_in
      }
    };
  }

  async ensureOrganizationMembership(userId: string, organizationId: string): Promise<void> {
    const { data, error } = await this.serviceClient
      .from('organization_memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .maybeSingle();

    assertNoQueryError(error);

    if (!data) {
      throw new Error('ACCESS_ORGANIZATION_FORBIDDEN');
    }
  }

  async hasPermission(userId: string, organizationId: string, permissionKey: string): Promise<boolean> {
    const { data, error } = await this.serviceClient
      .from('organization_memberships')
      .select('role_id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .maybeSingle();

    assertNoQueryError(error);

    if (!data) {
      return false;
    }

    const { data: permissionData, error: permissionError } = await this.serviceClient
      .from('role_permissions')
      .select('id')
      .eq('role_id', (data as { role_id: string }).role_id)
      .eq('organization_id', organizationId)
      .eq('permission_key', permissionKey)
      .maybeSingle();

    assertNoQueryError(permissionError);
    return Boolean(permissionData);
  }

  async listMemberships(userId: string): Promise<Array<{ organizationId: string; roleId: string; status: string }>> {
    const { data, error } = await this.serviceClient
      .from('organization_memberships')
      .select('organization_id,role_id,status')
      .eq('user_id', userId)
      .eq('status', 'active');

    assertNoQueryError(error);
    return ((data ?? []) as Array<{ organization_id: string; role_id: string; status: string }>).map((membership) => ({
      organizationId: membership.organization_id,
      roleId: membership.role_id,
      status: membership.status
    }));
  }

  async listPermissionsByOrganization(userId: string): Promise<Record<string, string[]>> {
    const memberships = await this.listMemberships(userId);
    if (memberships.length === 0) {
      return {};
    }

    const roleIds = memberships.map((membership) => membership.roleId);
    const organizationIds = memberships.map((membership) => membership.organizationId);
    const { data, error } = await this.serviceClient
      .from('role_permissions')
      .select('organization_id,role_id,permission_key')
      .in('organization_id', organizationIds)
      .in('role_id', roleIds);

    assertNoQueryError(error);

    return ((data ?? []) as Array<{ organization_id: string; role_id: string; permission_key: string }>).reduce<Record<string, string[]>>(
      (accumulator, row) => {
        const existing = accumulator[row.organization_id] ?? [];
        if (!existing.includes(row.permission_key)) {
          existing.push(row.permission_key);
        }
        accumulator[row.organization_id] = existing;
        return accumulator;
      },
      {}
    );
  }
}
