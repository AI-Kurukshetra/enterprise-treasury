import type { AppRouteHandler, RouteMiddleware } from '@/middleware/types';
import { AppError } from '@/errors/AppError';
import { updateActiveRequestContext } from '@/lib/requestContext';

export type RateLimitPolicyName = 'api.default' | 'api.sensitive' | 'auth.login' | 'copilot.chat';

interface RateLimitPolicy {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

type RateLimitStore = Map<string, RateLimitBucket>;

const store: RateLimitStore = new Map();

const policies: Record<RateLimitPolicyName, RateLimitPolicy> = {
  'api.default': { windowMs: 60_000, maxRequests: 300 },
  'api.sensitive': { windowMs: 60_000, maxRequests: 30 },
  'auth.login': { windowMs: 60_000, maxRequests: 10 },
  'copilot.chat': { windowMs: 60_000, maxRequests: 10 }
};

function resolveKey(request: Request, context: { user?: { id: string }; organizationId?: string; rateLimitKey?: string }): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwardedFor || request.headers.get('x-real-ip') || 'unknown';
  return [
    context.rateLimitKey,
    context.user?.id,
    context.organizationId,
    ip,
    request.method,
    new URL(request.url).pathname
  ]
    .filter(Boolean)
    .join(':');
}

function consume(storeRef: RateLimitStore, key: string, policy: RateLimitPolicy, now: number): RateLimitBucket {
  const existing = storeRef.get(key);
  if (!existing || existing.resetAt <= now) {
    const next = { count: 1, resetAt: now + policy.windowMs };
    storeRef.set(key, next);
    return next;
  }

  existing.count += 1;
  return existing;
}

export function rateLimitMiddleware(policyName: RateLimitPolicyName, storeOverride?: RateLimitStore): RouteMiddleware {
  return (handler: AppRouteHandler): AppRouteHandler => {
    return async (request, context) => {
      const policy = policies[policyName];
      const key = resolveKey(request, context);
      updateActiveRequestContext({ rateLimitKey: key });
      const bucket = consume(storeOverride ?? store, key, policy, Date.now());

      if (bucket.count > policy.maxRequests) {
        throw new AppError('Rate limit exceeded', {
          statusCode: 429,
          code: 'ACCESS_RATE_LIMITED',
          details: {
            policy: policyName,
            retryAfterMs: Math.max(bucket.resetAt - Date.now(), 0)
          }
        });
      }

      return handler(request, context);
    };
  };
}

export function clearRateLimitStore(): void {
  store.clear();
}
