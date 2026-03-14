import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { executeRoute } from '@/api/route';
import { registerErrorTrackingHook } from '@/lib/errorTracking';
import { readCounter, readTimings } from '@/lib/metrics';
import { AppError } from '@/errors/AppError';

describe('observability and route execution', () => {
  it('emits metrics and correlation headers for successful requests', async () => {
    const response = await executeRoute(
      new NextRequest('https://example.com/api/v1/health', {
        method: 'GET',
        headers: {
          'x-request-id': 'req-observe',
          'x-trace-id': 'trace-observe'
        }
      }),
      {
        requiresAuth: false,
        requiresOrganization: false
      },
      async () => NextResponse.json({ ok: true })
    );

    expect(response.headers.get('x-request-id')).toBe('req-observe');
    expect(response.headers.get('x-trace-id')).toBe('trace-observe');
    expect(readCounter('api.requests.total')).toBe(1);
    expect(readCounter('api.requests.status.200')).toBe(1);
    expect(readTimings('api.requests.duration_ms')).toHaveLength(1);
  });

  it('captures errors through the registered error tracking hooks', async () => {
    const trackingHook = vi.fn();
    registerErrorTrackingHook(trackingHook);

    const response = await executeRoute(
      new NextRequest('https://example.com/api/v1/fail', { method: 'GET' }),
      {
        requiresAuth: false,
        requiresOrganization: false
      },
      async () => {
        throw new AppError('forced failure', {
          statusCode: 503,
          code: 'SYSTEM_FORCED_FAILURE'
        });
      }
    );

    expect(response.status).toBe(503);
    expect(trackingHook).toHaveBeenCalledOnce();
    expect(readCounter('api.requests.failed')).toBe(1);
  });
});
