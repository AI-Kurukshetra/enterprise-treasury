import type { PaginationInput } from '@/types/common';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function resolveLimit(input: PaginationInput): number {
  const limit = input.limit ?? DEFAULT_PAGE_SIZE;
  if (limit <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(limit, MAX_PAGE_SIZE);
}

export function toNextCursor(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return Buffer.from(value, 'utf8').toString('base64');
}

export function fromCursor(cursor: string | undefined): string | null {
  if (!cursor) {
    return null;
  }

  try {
    return Buffer.from(cursor, 'base64').toString('utf8');
  } catch {
    return null;
  }
}
