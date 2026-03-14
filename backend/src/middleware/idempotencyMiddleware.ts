import type { AppRouteHandler, RouteMiddleware } from '@/middleware/types';
import { ValidationError } from '@/errors/ValidationError';
import { updateActiveRequestContext } from '@/lib/requestContext';

export function idempotencyMiddleware(): RouteMiddleware {
  return (handler: AppRouteHandler): AppRouteHandler => {
    return async (request, context) => {
      const isIdempotentPaymentMutation =
        request.method === 'POST' &&
        request.nextUrl.pathname.startsWith('/api/v1/payments') &&
        (!request.nextUrl.pathname.endsWith('/cancel'));

      if (!isIdempotentPaymentMutation) {
        return handler(request, context);
      }

      const idempotencyKey = request.headers.get('idempotency-key');
      if (!idempotencyKey) {
        throw new ValidationError('Missing required Idempotency-Key header for payment mutation');
      }

      context.idempotencyKey = idempotencyKey;
      updateActiveRequestContext({
        rateLimitKey: `${request.method}:${request.nextUrl.pathname}:${idempotencyKey}`
      });
      return handler(request, context);
    };
  };
}
