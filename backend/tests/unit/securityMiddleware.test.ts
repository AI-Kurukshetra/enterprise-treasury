import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { applySecurityChecks, getInjectedRequestId } from '@/middleware/securityMiddleware';

describe('securityMiddleware', () => {
  it('allows safe requests and injects a request id when missing', () => {
    const request = new NextRequest('https://api.example.com/api/v1/payments', {
      method: 'GET'
    });

    expect(applySecurityChecks(request)).toBeNull();
    expect(getInjectedRequestId(request)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  it('rejects requests above the 10MB size limit', async () => {
    const request = new NextRequest('https://api.example.com/api/v1/transactions/import', {
      method: 'POST',
      headers: {
        'content-length': String(10 * 1024 * 1024 + 1)
      }
    });

    const response = applySecurityChecks(request);
    const body = response ? await response.json() : null;

    expect(response?.status).toBe(413);
    expect(body?.error.code).toBe('SECURITY_REQUEST_TOO_LARGE');
  });

  it('rejects invalid content-length headers', async () => {
    const request = new NextRequest('https://api.example.com/api/v1/payments', {
      method: 'POST',
      headers: {
        'content-length': 'not-a-number'
      }
    });

    const response = applySecurityChecks(request);
    const body = response ? await response.json() : null;

    expect(response?.status).toBe(400);
    expect(body?.error.code).toBe('SECURITY_INVALID_CONTENT_LENGTH');
  });

  it('rejects suspicious override headers', async () => {
    const request = new NextRequest('https://api.example.com/api/v1/payments', {
      method: 'POST',
      headers: {
        'x-http-method-override': 'DELETE'
      }
    });

    const response = applySecurityChecks(request);
    const body = response ? await response.json() : null;

    expect(response?.status).toBe(400);
    expect(body?.error.code).toBe('SECURITY_SUSPICIOUS_HEADERS');
  });

  it('rejects ambiguous transfer framing headers', async () => {
    const request = new NextRequest('https://api.example.com/api/v1/payments', {
      method: 'POST',
      headers: {
        'content-length': '100',
        'transfer-encoding': 'chunked'
      }
    });

    const response = applySecurityChecks(request);
    const body = response ? await response.json() : null;

    expect(response?.status).toBe(400);
    expect(body?.error.code).toBe('SECURITY_SUSPICIOUS_HEADERS');
  });
});
