import type { AppRouteHandler, RouteMiddleware } from '@/middleware/types';

export function composeMiddlewares(handler: AppRouteHandler, middlewares: RouteMiddleware[]): AppRouteHandler {
  return middlewares.reduceRight((next, middleware) => middleware(next), handler);
}
