import type { RequestContext } from '@/types/context';
import type { ServiceContext } from '@/services/context';
import { AuthorizationError } from '@/errors/AuthorizationError';

export function toServiceContext(context: RequestContext): ServiceContext {
  if (!context.user) {
    throw new AuthorizationError('Missing user context');
  }

  if (!context.organizationId) {
    throw new AuthorizationError('Missing organization context');
  }

  return {
    organizationId: context.organizationId,
    userId: context.user.id,
    requestId: context.requestId
  };
}
