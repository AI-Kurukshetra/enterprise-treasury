import { AppError } from '@/errors/AppError';
import type { AppRouteHandler, RouteMiddleware } from '@/middleware/types';
import { AuthorizationError } from '@/errors/AuthorizationError';
import { AuthenticationError } from '@/errors/AuthenticationError';
import { updateActiveRequestContext } from '@/lib/requestContext';
import { AccessRepository } from '@/repositories/access/repository';

function parseBearerToken(authorizationHeader: string | null): string {
  if (!authorizationHeader) {
    throw new AuthorizationError('Missing Authorization header');
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AuthorizationError('Invalid Authorization header format');
  }

  return token;
}

export function authMiddleware(accessRepository?: AccessRepository): RouteMiddleware {
  return (handler: AppRouteHandler): AppRouteHandler => {
    return async (request, context) => {
      const repository = accessRepository ?? new AccessRepository();
      const token = parseBearerToken(request.headers.get('authorization'));

      try {
        const user = await repository.authenticate(token);
        context.user = {
          id: user.id,
          email: user.email ?? 'unknown@example.com'
        };
        updateActiveRequestContext({
          actorId: context.user.id
        });
        return handler(request, context);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        throw new AuthenticationError('Invalid or expired token');
      }
    };
  };
}
