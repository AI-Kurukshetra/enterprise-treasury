import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import type { AuthProfile } from '@/lib/types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3001/api/v1';

function flattenPermissions(profile: AuthProfile): string[] {
  return Array.from(new Set(Object.values(profile.permissions).flatMap((items) => items)));
}

export function hasPermission(profile: AuthProfile, permission: string): boolean {
  return flattenPermissions(profile).includes(permission);
}

export function hasPermissionPrefix(profile: AuthProfile, prefix: string): boolean {
  return flattenPermissions(profile).some((permission) => permission.startsWith(prefix));
}

export async function getServerProfile(): Promise<AuthProfile> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect('/login');
  }

  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    redirect('/dashboard');
  }

  const payload = (await response.json()) as { data: AuthProfile };
  return payload.data;
}

export async function requireServerPermission(permission: string): Promise<AuthProfile> {
  const profile = await getServerProfile();
  if (!hasPermission(profile, permission)) {
    redirect('/dashboard');
  }

  return profile;
}

export async function requireServerAdminAccess(): Promise<AuthProfile> {
  const profile = await getServerProfile();
  if (!hasPermissionPrefix(profile, 'admin.') && !hasPermissionPrefix(profile, 'policy.')) {
    redirect('/dashboard');
  }

  return profile;
}
