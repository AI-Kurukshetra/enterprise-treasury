import { NextResponse, type NextRequest } from 'next/server';
import { authMiddleware } from '@/middleware/authMiddleware';
import { auditLoggingMiddleware } from '@/middleware/auditLoggingMiddleware';
import { applyCorsHeaders, handleCorsPreflight } from '@/middleware/corsMiddleware';
import { composeMiddlewares } from '@/middleware/compose';
import { idempotencyMiddleware } from '@/middleware/idempotencyMiddleware';
import { organizationContextMiddleware } from '@/middleware/organizationContextMiddleware';
import { rateLimitMiddleware, type RateLimitPolicyName } from '@/middleware/rateLimitMiddleware';
import { applySecurityChecks, getInjectedRequestId } from '@/middleware/securityMiddleware';
import type { AppRouteHandler, RouteMiddleware } from '@/middleware/types';
import { fail } from '@/lib/http';
import { captureError } from '@/lib/errorTracking';
import { incrementCounter, recordTiming } from '@/lib/metrics';
import { runWithRequestContext } from '@/lib/requestContext';
import { getTraceId } from '@/lib/tracing';
import type { RequestContext } from '@/types/context';

export interface RouteExecutionOptions {
  requiresAuth?: boolean;
  requiresOrganization?: boolean;
  requiredPermission?: string;
  useIdempotency?: boolean;
  rateLimit?: RateLimitPolicyName;
}

export async function executeRoute(
  request: NextRequest,
  options: RouteExecutionOptions,
  handler: AppRouteHandler
): Promise<NextResponse> {
  const securityResponse = applySecurityChecks(request);
  const requestId = getInjectedRequestId(request);
  const traceId = getTraceId(request.headers.get('x-trace-id'));

  if (securityResponse) {
    securityResponse.headers.set('x-request-id', requestId);
    securityResponse.headers.set('x-trace-id', traceId);
    return applyCorsHeaders(securityResponse, request);
  }

  const context: RequestContext = {
    requestId,
    traceId,
    method: request.method as RequestContext['method'],
    path: request.nextUrl.pathname,
    requiredPermission: options.requiredPermission
  };

  const middlewares: RouteMiddleware[] = [auditLoggingMiddleware()];

  if (options.requiresAuth ?? true) {
    middlewares.push(authMiddleware());
  }

  if (options.requiresOrganization ?? true) {
    middlewares.push(organizationContextMiddleware());
  }

  if (options.useIdempotency) {
    middlewares.push(idempotencyMiddleware());
  }

  middlewares.push(rateLimitMiddleware(options.rateLimit ?? (options.requiredPermission || options.useIdempotency ? 'api.sensitive' : 'api.default')));

  const guardedHandler = composeMiddlewares(handler, middlewares);
  const startedAt = Date.now();

  try {
    incrementCounter('api.requests.total');
    const response = await runWithRequestContext(
      {
        requestId,
        traceId,
        path: request.nextUrl.pathname,
        method: request.method
      },
      () => guardedHandler(request, context)
    );
    recordTiming('api.requests.duration_ms', Date.now() - startedAt);
    incrementCounter(`api.requests.status.${response.status}`);
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-trace-id', traceId);
    return applyCorsHeaders(response, request);
  } catch (error) {
    incrementCounter('api.requests.failed');
    recordTiming('api.requests.duration_ms', Date.now() - startedAt);
    // Surface stack traces in local/dev logs to speed up operational debugging.
    if (process.env.NODE_ENV !== 'production' && typeof console?.error === 'function') {
      // eslint-disable-next-line no-console
      console.error(error);
    }
    await captureError({
      error,
      requestId,
      traceId,
      path: request.nextUrl.pathname,
      method: request.method,
      organizationId: context.organizationId,
      actorId: context.user?.id
    });
    const failureResponse = fail(error, requestId);
    failureResponse.headers.set('x-request-id', requestId);
    failureResponse.headers.set('x-trace-id', traceId);
    return applyCorsHeaders(failureResponse, request);
  }
}

export function buildOptionsHandler() {
  return async function OPTIONS(request: NextRequest): Promise<NextResponse> {
    const requestId = getInjectedRequestId(request);
    const traceId = getTraceId(request.headers.get('x-trace-id'));
    const response = handleCorsPreflight(request, new NextResponse(null, { status: 204 }));
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-trace-id', traceId);
    return response;
  };
}

export function queryParamsToObject(request: NextRequest): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    result[key] = value;
  }
  return result;
}
