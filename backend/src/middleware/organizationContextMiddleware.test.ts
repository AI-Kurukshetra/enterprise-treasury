import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { organizationContextMiddleware } from '@/middleware/organizationContextMiddleware';
import { AuthorizationError } from '@/errors/AuthorizationError';

describe('organizationContextMiddleware', () => {
  it('throws when organization membership is invalid', async () => {
    const middleware = organizationContextMiddleware({
      ensureOrganizationMembership: async () => {
        throw new Error('ACCESS_ORGANIZATION_FORBIDDEN');
      },
      hasPermission: async () => false,
      authenticate: async () => {
        throw new Error('not used');
      }
    } as never);

    const handler = middleware(async () => NextResponse.json({ ok: true }));

    const request = new NextRequest('https://example.com/api/v1/accounts', {
      method: 'GET',
      headers: {
        'x-organization-id': 'org-1'
      }
    });

    await expect(
      handler(request, {
        requestId: 'req-1',
        traceId: 'trace-1',
        method: 'GET',
        path: '/api/v1/accounts',
        user: {
          id: 'user-1',
          email: 'user@example.com'
        }
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('throws when the organization header is missing', async () => {
    const middleware = organizationContextMiddleware({
      ensureOrganizationMembership: async () => undefined,
      hasPermission: async () => true,
      authenticate: async () => {
        throw new Error('not used');
      }
    } as never);

    const handler = middleware(async () => NextResponse.json({ ok: true }));
    const request = new NextRequest('https://example.com/api/v1/accounts', { method: 'GET' });

    await expect(
      handler(request, {
        requestId: 'req-2',
        traceId: 'trace-2',
        method: 'GET',
        path: '/api/v1/accounts',
        requiredPermission: 'accounts.update',
        user: {
          id: 'user-1',
          email: 'user@example.com'
        }
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('throws when the user lacks the required permission in the tenant context', async () => {
    const middleware = organizationContextMiddleware({
      ensureOrganizationMembership: async () => undefined,
      hasPermission: async () => false,
      authenticate: async () => {
        throw new Error('not used');
      }
    } as never);

    const handler = middleware(async () => NextResponse.json({ ok: true }));
    const request = new NextRequest('https://example.com/api/v1/accounts', {
      method: 'GET',
      headers: {
        'x-organization-id': 'org-1'
      }
    });

    await expect(
      handler(request, {
        requestId: 'req-3',
        traceId: 'trace-3',
        method: 'GET',
        path: '/api/v1/accounts',
        requiredPermission: 'accounts.update',
        user: {
          id: 'user-1',
          email: 'user@example.com'
        }
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
