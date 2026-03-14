import { randomUUID } from 'node:crypto';

export function getRequestId(inputRequestId: string | null): string {
  return inputRequestId && inputRequestId.length > 0 ? inputRequestId : randomUUID();
}

export function getTraceId(inputTraceId: string | null): string {
  return inputTraceId && inputTraceId.length > 0 ? inputTraceId : randomUUID();
}
