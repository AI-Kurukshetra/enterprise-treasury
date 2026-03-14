import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { applyCursorPagination } from '@/repositories/base/query';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { PaginatedResult, PaginationInput } from '@/types/common';
import type { CreateInvestmentInput, Investment } from '@/types/investments/types';
import { coerceDecimalString } from '@/utils/database';
import { resolveLimit, toNextCursor } from '@/utils/pagination';

export interface InvestmentFilters {
  status?: Investment['status'];
  maturityFrom?: string;
  maturityTo?: string;
  instrumentType?: string;
}

function normalizeInvestment(row: Investment): Investment {
  return {
    ...row,
    principal_amount: coerceDecimalString((row as unknown as Record<string, unknown>).principal_amount)
  };
}

export class InvestmentsRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async list(filters: InvestmentFilters, pagination: PaginationInput): Promise<PaginatedResult<Investment>> {
    let query = this.db.from('investments').select('*').eq('organization_id', this.context.organizationId);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.maturityFrom) {
      query = query.gte('maturity_date', filters.maturityFrom);
    }
    if (filters.maturityTo) {
      query = query.lte('maturity_date', filters.maturityTo);
    }
    if (filters.instrumentType) {
      query = query.eq('instrument_type', filters.instrumentType);
    }

    const paged = applyCursorPagination(query, pagination, { cursorColumn: 'id' });
    const { data, error } = await paged;
    assertNoQueryError(error);

    const limit = resolveLimit(pagination);
    const rows = ((data ?? []) as Investment[]).map(normalizeInvestment);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? toNextCursor(items[items.length - 1]?.id) : null;

    return { items, nextCursor };
  }

  async create(input: CreateInvestmentInput): Promise<Investment> {
    const { data, error } = await this.db
      .from('investments')
      .insert({
        organization_id: this.context.organizationId,
        instrument_name: input.instrumentName,
        instrument_type: input.instrumentType,
        principal_amount: input.principalAmount,
        currency_code: input.currencyCode,
        start_date: input.startDate,
        maturity_date: input.maturityDate,
        rate: input.rate ?? null,
        status: 'active'
      })
      .select('*')
      .single();

    assertNoQueryError(error);
    return normalizeInvestment(data as Investment);
  }

  async findById(investmentId: string): Promise<Investment | null> {
    const { data, error } = await this.db
      .from('investments')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('id', investmentId)
      .maybeSingle();

    assertNoQueryError(error);
    return data ? normalizeInvestment(data as Investment) : null;
  }
}
