import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { applyCursorPagination } from '@/repositories/base/query';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { PaginatedResult, PaginationInput } from '@/types/common';
import type { Counterparty, CounterpartyFilters } from '@/types/counterparties/types';
import { resolveLimit, toNextCursor } from '@/utils/pagination';

export class CounterpartiesRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async list(filters: CounterpartyFilters, pagination: PaginationInput): Promise<PaginatedResult<Counterparty>> {
    let query = this.db.from('counterparties').select('*').eq('organization_id', this.context.organizationId);

    if (filters.type) {
      query = query.eq('type', filters.type);
    }

    if (filters.search) {
      query = query.ilike('name', `%${filters.search}%`);
    }

    const paged = applyCursorPagination(query.order('name', { ascending: true }), pagination, {
      cursorColumn: 'name'
    });
    const { data, error } = await paged;
    assertNoQueryError(error);

    const limit = resolveLimit(pagination);
    const rows = (data ?? []) as Counterparty[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? toNextCursor(items[items.length - 1]?.name) : null;

    return { items, nextCursor };
  }

  async findById(counterpartyId: string): Promise<Counterparty | null> {
    const { data, error } = await this.db
      .from('counterparties')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('id', counterpartyId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as Counterparty | null) ?? null;
  }
}
