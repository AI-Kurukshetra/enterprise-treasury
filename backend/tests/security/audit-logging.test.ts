import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { auditLoggingMiddleware } from '@/middleware/auditLoggingMiddleware';

describe('audit logging middleware', () => {
  it('emits audit rows for successful financial mutations', async () => {
    const insertAuditLog = vi.fn(async () => undefined);
    const middleware = auditLoggingMiddleware({ insertAuditLog });
    const handler = middleware(async () => NextResponse.json({ ok: true }, { status: 201 }));

    await handler(
      new NextRequest('https://example.com/api/v1/payments', {
        method: 'POST'
      }),
      {
        requestId: 'req-audit-1',
        traceId: 'trace-audit-1',
        method: 'POST',
        path: '/api/v1/payments',
        organizationId: 'org-1',
        user: {
          id: 'user-1',
          email: 'user-1@example.com'
        }
      }
    );

    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-1',
        user_id: 'user-1',
        action: 'POST /api/v1/payments',
        entity_type: 'http_request',
        request_id: 'req-audit-1',
        source_channel: 'api'
      })
    );
  });
});
