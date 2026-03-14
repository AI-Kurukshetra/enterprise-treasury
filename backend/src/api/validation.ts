import type { NextRequest } from 'next/server';
import type { ZodType, ZodTypeDef } from 'zod';
import { queryParamsToObject } from '@/api/route';

export async function parseJsonBody<T>(
  request: NextRequest,
  schema: ZodType<T, ZodTypeDef, unknown>
): Promise<T> {
  const body = (await request.json()) as unknown;
  return schema.parse(body);
}

export function parseQuery<T>(request: NextRequest, schema: ZodType<T, ZodTypeDef, unknown>): T {
  return schema.parse(queryParamsToObject(request));
}

export function parseResponse<T>(data: unknown, schema: ZodType<T, ZodTypeDef, unknown>): T {
  return schema.parse(data);
}
