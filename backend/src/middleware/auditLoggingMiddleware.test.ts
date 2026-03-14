import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { auditLoggingMiddleware } from '@/middleware/auditLoggingMiddleware';

describe('auditLoggingMiddleware', () => {
  it('persists success audit events with the current actor and tenant context', async () => {
    const insertedPayloads: Record<string, unknown>[] = [];
    const middleware = auditLoggingMiddleware({
      insertAuditLog: async (payload) => {
        insertedPayloads.push(payload);
      }
    });
    const handler = middleware(async () => NextResponse.json({ ok: true }, { status: 201 }));

    const response = await handler(
      new NextRequest('https://example.com/api/v1/payments', {
        method: 'POST'
      }),
      {
        requestId: 'req-1',
        traceId: 'trace-1',
        method: 'POST',
        path: '/api/v1/payments',
        organizationId: 'org-1',
        user: {
          id: 'user-1',
          email: 'user@example.com'
        }
      }
    );

    expect(response.status).toBe(201);
    expect(insertedPayloads).toHaveLength(1);
    expect(insertedPayloads[0]).toMatchObject({
      organization_id: 'org-1',
      user_id: 'user-1',
      entity_type: 'http_request',
      source_channel: 'api',
      request_id: 'req-1'
    });
  });
});
