import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AuthorizationError } from '@/errors/AuthorizationError';
import { organizationContextMiddleware } from '@/middleware/organizationContextMiddleware';
import { executeRoute } from '@/api/route';

describe('multi-tenant isolation and security controls', () => {
  it('rejects cross-tenant access when the user is not a member of the requested organization', async () => {
    const handler = organizationContextMiddleware({
      ensureOrganizationMembership: async () => {
        throw new Error('ACCESS_ORGANIZATION_FORBIDDEN');
      },
      hasPermission: async () => true,
      authenticate: async () => {
        throw new Error('not used');
      }
    } as never)(async () => NextResponse.json({ ok: true }));

    await expect(
      handler(
        new NextRequest('https://example.com/api/v1/accounts', {
          method: 'GET',
          headers: {
            'x-organization-id': 'org-b'
          }
        }),
        {
          requestId: 'req-1',
          traceId: 'trace-1',
          method: 'GET',
          path: '/api/v1/accounts',
          user: {
            id: 'user-a',
            email: 'user-a@example.com'
          }
        }
      )
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('enforces sensitive route rate limits deterministically', async () => {
    let lastResponse = null as Response | null;

    for (let index = 0; index < 31; index += 1) {
      lastResponse = await executeRoute(
        new NextRequest('https://example.com/api/v1/payments', {
          method: 'POST',
          headers: {
            'x-real-ip': '10.0.0.1'
          }
        }),
        {
          requiresAuth: false,
          requiresOrganization: false,
          rateLimit: 'api.sensitive'
        },
        async () => NextResponse.json({ ok: true })
      );
    }

    expect(lastResponse?.status).toBe(429);
  });
});
