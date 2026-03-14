import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { idempotencyMiddleware } from '@/middleware/idempotencyMiddleware';
import { ValidationError } from '@/errors/ValidationError';

describe('idempotencyMiddleware', () => {
  it('requires Idempotency-Key for payment retry routes', async () => {
    const middleware = idempotencyMiddleware();
    const handler = middleware(async () => NextResponse.json({ ok: true }));

    const request = new NextRequest('https://example.com/api/v1/payments/payment-1/retry', {
      method: 'POST'
    });

    await expect(
      handler(request, {
        requestId: 'req-1',
        traceId: 'trace-1',
        method: 'POST',
        path: '/api/v1/payments/payment-1/retry'
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('propagates the idempotency key into request context', async () => {
    const middleware = idempotencyMiddleware();
    const handler = middleware(async (_request, context) => NextResponse.json({ idempotencyKey: context.idempotencyKey }));

    const request = new NextRequest('https://example.com/api/v1/payments/payment-1/retry', {
      method: 'POST',
      headers: {
        'idempotency-key': 'retry-1'
      }
    });

    const response = await handler(request, {
      requestId: 'req-2',
      traceId: 'trace-2',
      method: 'POST',
      path: '/api/v1/payments/payment-1/retry'
    });
    expect(await response.json()).toEqual({ idempotencyKey: 'retry-1' });
  });
});
