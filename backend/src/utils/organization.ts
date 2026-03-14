import { AuthorizationError } from '@/errors/AuthorizationError';

export function assertOrganizationId(organizationId: string | undefined): string {
  if (!organizationId) {
    throw new AuthorizationError('Missing organization context');
  }
  return organizationId;
}
