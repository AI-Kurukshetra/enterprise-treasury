import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { rateLimitMiddleware } from '@/middleware/rateLimitMiddleware';
import { AppError } from '@/errors/AppError';

describe('rateLimitMiddleware', () => {
  it('rejects requests that exceed the configured threshold', async () => {
    const middleware = rateLimitMiddleware('auth.login', new Map());
    const handler = middleware(async () => NextResponse.json({ ok: true }));
    const request = new NextRequest('https://example.com/api/v1/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '203.0.113.10'
      }
    });

    for (let index = 0; index < 10; index += 1) {
      const response = await handler(request, {
        requestId: `req-${index}`,
        traceId: `trace-${index}`,
        method: 'POST',
        path: '/api/v1/auth/login'
      });
      expect(response.status).toBe(200);
    }

    await expect(
      handler(request, {
        requestId: 'req-11',
        traceId: 'trace-11',
        method: 'POST',
        path: '/api/v1/auth/login'
      })
    ).rejects.toBeInstanceOf(AppError);
  });
});
