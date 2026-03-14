import type { NextRequest, NextResponse } from 'next/server';
import { getAllowedOrigins } from '@/config/env';

const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const ALLOW_HEADERS = 'Content-Type, Authorization, X-Idempotency-Key, X-Organization-Id, X-Request-Id';
const MAX_AGE_SECONDS = '86400';

function getNormalizedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin');
  if (!origin) {
    return null;
  }

  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) {
    return false;
  }

  return getAllowedOrigins().includes(origin);
}

export function applyCorsHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const origin = getNormalizedOrigin(request);

  response.headers.set('Access-Control-Allow-Methods', ALLOW_METHODS);
  response.headers.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
  response.headers.set('Access-Control-Max-Age', MAX_AGE_SECONDS);
  response.headers.set('Vary', 'Origin');

  if (isAllowedOrigin(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  } else {
    response.headers.delete('Access-Control-Allow-Origin');
  }

  return response;
}

export function handleCorsPreflight(request: NextRequest, response: NextResponse): NextResponse {
  return applyCorsHeaders(response, request);
}
