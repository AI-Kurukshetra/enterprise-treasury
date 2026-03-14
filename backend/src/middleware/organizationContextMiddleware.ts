import type { AppRouteHandler, RouteMiddleware } from '@/middleware/types';
import { AuthorizationError } from '@/errors/AuthorizationError';
import { updateActiveRequestContext } from '@/lib/requestContext';
import { AccessRepository } from '@/repositories/access/repository';

export function organizationContextMiddleware(accessRepository?: AccessRepository): RouteMiddleware {
  return (handler: AppRouteHandler): AppRouteHandler => {
    return async (request, context) => {
      if (!context.user) {
        throw new AuthorizationError('Authenticated user context is required');
      }

      const organizationId = request.headers.get('x-organization-id');
      if (!organizationId) {
        throw new AuthorizationError('Missing organization context header x-organization-id');
      }

      const repository = accessRepository ?? new AccessRepository();
      try {
        await repository.ensureOrganizationMembership(context.user.id, organizationId);

        if (context.requiredPermission) {
          const hasPermission = await repository.hasPermission(
            context.user.id,
            organizationId,
            context.requiredPermission
          );
          if (!hasPermission) {
            throw new AuthorizationError('Insufficient permission for this operation', {
              permission: context.requiredPermission
            });
          }
        }
      } catch (error) {
        if (error instanceof AuthorizationError) {
          throw error;
        }
        throw new AuthorizationError('Invalid organization context for current user');
      }

      context.organizationId = organizationId;
      updateActiveRequestContext({
        organizationId
      });
      return handler(request, context);
    };
  };
}
