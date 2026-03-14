import { NextResponse } from 'next/server';
import type { ApiMeta, ApiSuccess } from '@/types/api';
import { getStatusCode, toApiError } from '@/errors/errorHandler';

export function buildMeta(requestId: string): ApiMeta {
  return {
    requestId,
    timestamp: new Date().toISOString()
  };
}

export function ok<T>(data: T, requestId: string, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json(
    {
      data,
      meta: buildMeta(requestId)
    },
    { status }
  );
}

export function fail(error: unknown, requestId: string): NextResponse {
  return NextResponse.json(toApiError(error, buildMeta(requestId)), {
    status: getStatusCode(error)
  });
}
