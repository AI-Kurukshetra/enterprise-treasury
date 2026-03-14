import type { AppRouteHandler, RouteMiddleware } from '@/middleware/types';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { getActiveRequestContext } from '@/lib/requestContext';

export interface AuditLoggerDeps {
  insertAuditLog?: (payload: Record<string, unknown>) => Promise<void>;
}

function shouldAudit(method: string): boolean {
  return method !== 'GET';
}

export function auditLoggingMiddleware(deps: AuditLoggerDeps = {}): RouteMiddleware {
  return (handler: AppRouteHandler): AppRouteHandler => {
    return async (request, context) => {
      const startedAt = Date.now();
      const insertAuditLog =
        deps.insertAuditLog ??
        (async (payload: Record<string, unknown>) => {
          const db = createServiceSupabaseClient();
          await db.from('audit_logs').insert(payload);
        });

      try {
        const response = await handler(request, context);
        const finalContext = getActiveRequestContext();

        logger.log({
          level: 'info',
          message: 'api_request_completed',
          requestId: context.requestId,
          organizationId: finalContext?.organizationId ?? context.organizationId,
          actorId: finalContext?.actorId ?? context.user?.id,
          domain: 'api',
          eventType: 'request_success',
          data: {
            path: request.nextUrl.pathname,
            method: request.method,
            status: response.status,
            durationMs: Date.now() - startedAt,
            traceId: finalContext?.traceId ?? context.traceId
          }
        });

        if (shouldAudit(request.method) && (finalContext?.organizationId ?? context.organizationId) && (finalContext?.actorId ?? context.user?.id)) {
          await insertAuditLog({
            organization_id: finalContext?.organizationId ?? context.organizationId,
            user_id: finalContext?.actorId ?? context.user?.id,
            action: `${request.method} ${request.nextUrl.pathname}`,
            entity_type: 'http_request',
            request_id: context.requestId,
            source_channel: 'api',
            metadata: {
              status: response.status,
              durationMs: Date.now() - startedAt,
              method: request.method,
              path: request.nextUrl.pathname,
              traceId: finalContext?.traceId ?? context.traceId
            }
          });
        }

        return response;
      } catch (error) {
        const finalContext = getActiveRequestContext();
        logger.log({
          level: 'error',
          message: 'api_request_failed',
          requestId: context.requestId,
          organizationId: finalContext?.organizationId ?? context.organizationId,
          actorId: finalContext?.actorId ?? context.user?.id,
          domain: 'api',
          eventType: 'request_failed',
          data: {
            path: request.nextUrl.pathname,
            method: request.method,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : 'Unknown error',
            traceId: finalContext?.traceId ?? context.traceId
          }
        });

        if (shouldAudit(request.method) && (finalContext?.organizationId ?? context.organizationId) && (finalContext?.actorId ?? context.user?.id)) {
          await insertAuditLog({
            organization_id: finalContext?.organizationId ?? context.organizationId,
            user_id: finalContext?.actorId ?? context.user?.id,
            action: `${request.method} ${request.nextUrl.pathname}`,
            entity_type: 'http_request',
            request_id: context.requestId,
            source_channel: 'api',
            metadata: {
              status: 'failed',
              durationMs: Date.now() - startedAt,
              error: error instanceof Error ? error.message : 'Unknown error',
              method: request.method,
              path: request.nextUrl.pathname,
              traceId: finalContext?.traceId ?? context.traceId
            }
          });
        }

        throw error;
      }
    };
  };
}
