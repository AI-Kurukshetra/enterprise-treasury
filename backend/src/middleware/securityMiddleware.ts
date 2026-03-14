import { NextResponse, type NextRequest } from 'next/server';
import { AppError } from '@/errors/AppError';
import { fail } from '@/lib/http';
import { getRequestId } from '@/lib/tracing';

const MAX_REQUEST_SIZE_BYTES = 10 * 1024 * 1024;

const OVERRIDE_HEADERS = ['x-http-method-override', 'x-original-url', 'x-rewrite-url'] as const;
const INSPECTED_HEADERS = ['origin', 'host', 'x-forwarded-host', 'x-forwarded-for'] as const;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

const requestIdStore = new WeakMap<NextRequest, string>();

function rejectRequest(statusCode: number, code: string, message: string, requestId: string, details?: Record<string, unknown>) {
  return fail(
    new AppError(message, {
      statusCode,
      code,
      details
    }),
    requestId
  );
}

export function getInjectedRequestId(request: NextRequest): string {
  const existing = requestIdStore.get(request);
  if (existing) {
    return existing;
  }

  const requestId = getRequestId(request.headers.get('x-request-id'));
  requestIdStore.set(request, requestId);
  return requestId;
}

export function applySecurityChecks(request: NextRequest): NextResponse | null {
  const requestId = getInjectedRequestId(request);

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      return rejectRequest(400, 'SECURITY_INVALID_CONTENT_LENGTH', 'Invalid Content-Length header', requestId);
    }

    if (contentLength > MAX_REQUEST_SIZE_BYTES) {
      return rejectRequest(413, 'SECURITY_REQUEST_TOO_LARGE', 'Request payload exceeds the 10MB limit', requestId, {
        maxBytes: MAX_REQUEST_SIZE_BYTES
      });
    }
  }

  if (request.headers.has('content-length') && request.headers.has('transfer-encoding')) {
    return rejectRequest(400, 'SECURITY_SUSPICIOUS_HEADERS', 'Suspicious request headers detected', requestId, {
      header: 'transfer-encoding'
    });
  }

  for (const headerName of OVERRIDE_HEADERS) {
    if (request.headers.has(headerName)) {
      return rejectRequest(400, 'SECURITY_SUSPICIOUS_HEADERS', 'Suspicious request headers detected', requestId, {
        header: headerName
      });
    }
  }

  for (const headerName of INSPECTED_HEADERS) {
    const headerValue = request.headers.get(headerName);
    if (headerValue && CONTROL_CHARACTER_PATTERN.test(headerValue)) {
      return rejectRequest(400, 'SECURITY_SUSPICIOUS_HEADERS', 'Suspicious request headers detected', requestId, {
        header: headerName
      });
    }
  }

  return null;
}
