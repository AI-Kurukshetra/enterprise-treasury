import { describe, expect, it } from 'vitest';
import { toServiceContext } from '@/api/serviceContext';
import { AuthorizationError } from '@/errors/AuthorizationError';
import { NotImplementedError } from '@/errors/NotImplementedError';
import { assertOrganizationId } from '@/utils/organization';

describe('request context guards', () => {
  it('converts request context into a service context for authenticated tenant requests', () => {
    expect(
      toServiceContext({
        requestId: 'req-1',
        traceId: 'trace-1',
        method: 'GET',
        path: '/api/v1/payments',
        organizationId: '00000000-0000-4000-8000-000000000001',
        user: {
          id: '00000000-0000-4000-8000-000000000101',
          email: 'treasurer@example.com'
        }
      })
    ).toEqual({
      organizationId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000101',
      requestId: 'req-1'
    });
  });

  it('rejects request contexts without an authenticated user', () => {
    expect(() =>
      toServiceContext({
        requestId: 'req-1',
        traceId: 'trace-1',
        method: 'GET',
        path: '/api/v1/payments',
        organizationId: '00000000-0000-4000-8000-000000000001'
      })
    ).toThrow(AuthorizationError);
  });

  it('rejects request contexts without an organization scope', () => {
    expect(() =>
      toServiceContext({
        requestId: 'req-1',
        traceId: 'trace-1',
        method: 'GET',
        path: '/api/v1/payments',
        user: {
          id: '00000000-0000-4000-8000-000000000101',
          email: 'treasurer@example.com'
        }
      })
    ).toThrow(AuthorizationError);
  });

  it('enforces presence of an organization id', () => {
    expect(assertOrganizationId('org-1')).toBe('org-1');
    expect(() => assertOrganizationId(undefined)).toThrow(AuthorizationError);
  });

  it('marks unimplemented paths with an explicit system error contract', () => {
    const error = new NotImplementedError('future workflow');
    expect(error.statusCode).toBe(501);
    expect(error.code).toBe('SYSTEM_NOT_IMPLEMENTED');
  });
});
