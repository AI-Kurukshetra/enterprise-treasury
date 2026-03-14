import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { applyCorsHeaders, handleCorsPreflight } from '@/middleware/corsMiddleware';

describe('corsMiddleware', () => {
  it('applies CORS headers for allowed origins', () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://console.example.com';

    const request = new NextRequest('https://api.example.com/api/v1/payments', {
      method: 'GET',
      headers: {
        origin: 'https://console.example.com'
      }
    });
    const response = applyCorsHeaders(new NextResponse(null, { status: 200 }), request);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://console.example.com');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, Authorization, X-Idempotency-Key, X-Organization-Id, X-Request-Id'
    );
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('does not emit Access-Control-Allow-Origin for disallowed origins', () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

    const request = new NextRequest('https://api.example.com/api/v1/payments', {
      method: 'GET',
      headers: {
        origin: 'https://evil.example.com'
      }
    });
    const response = applyCorsHeaders(new NextResponse(null, { status: 200 }), request);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS');
  });

  it('returns a 204-compatible preflight response with the allowlist headers', () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

    const request = new NextRequest('https://api.example.com/api/v1/payments', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:3000'
      }
    });
    const response = handleCorsPreflight(request, new NextResponse(null, { status: 204 }));

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
  });
});
