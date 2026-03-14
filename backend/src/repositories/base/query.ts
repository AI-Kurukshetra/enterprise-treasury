import type { PaginationInput } from '@/types/common';
import { resolveLimit, fromCursor } from '@/utils/pagination';

interface CursorQueryConfig {
  cursorColumn: string;
  ascending?: boolean;
}

interface TenantFilterQuery {
  eq(column: string, value: string): unknown;
}

interface CursorPaginationQuery {
  order(column: string, options: { ascending: boolean }): unknown;
  gt(column: string, value: string): unknown;
  lt(column: string, value: string): unknown;
  limit(value: number): unknown;
}

export function applyTenantFilter<Q extends TenantFilterQuery>(
  query: Q,
  organizationId: string
): Q {
  return query.eq('organization_id', organizationId) as Q;
}

export function applyCursorPagination<Q extends CursorPaginationQuery>(
  query: Q,
  pagination: PaginationInput,
  config: CursorQueryConfig
): Q {
  const limit = resolveLimit(pagination);
  const parsedCursor = fromCursor(pagination.cursor);

  let nextQuery = query.order(config.cursorColumn, {
    ascending: config.ascending ?? false
  }) as Q;

  if (parsedCursor) {
    nextQuery = (config.ascending ?? false)
      ? (nextQuery.gt(config.cursorColumn, parsedCursor) as Q)
      : (nextQuery.lt(config.cursorColumn, parsedCursor) as Q);
  }

  return nextQuery.limit(limit + 1) as Q;
}
