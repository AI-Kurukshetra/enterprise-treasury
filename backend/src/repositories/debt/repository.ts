import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { applyCursorPagination } from '@/repositories/base/query';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { PaginatedResult, PaginationInput } from '@/types/common';
import type { CreateDebtFacilityInput, DebtFacility, DebtScheduleLine } from '@/types/debt/types';
import { coerceDecimalString } from '@/utils/database';
import { resolveLimit, toNextCursor } from '@/utils/pagination';

export interface DebtFilters {
  status?: DebtFacility['status'];
}

function normalizeFacility(row: DebtFacility): DebtFacility {
  const source = row as unknown as Record<string, unknown>;
  return {
    ...row,
    limit_amount: coerceDecimalString(source.limit_amount),
    utilized_amount: coerceDecimalString(source.utilized_amount)
  };
}

function normalizeScheduleLine(row: DebtScheduleLine): DebtScheduleLine {
  const source = row as unknown as Record<string, unknown>;
  return {
    ...row,
    principal_due: coerceDecimalString(source.principal_due),
    interest_due: coerceDecimalString(source.interest_due)
  };
}

export class DebtRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async listFacilities(filters: DebtFilters, pagination: PaginationInput): Promise<PaginatedResult<DebtFacility>> {
    let query = this.db.from('debt_facilities').select('*').eq('organization_id', this.context.organizationId);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    const paged = applyCursorPagination(query, pagination, { cursorColumn: 'id' });
    const { data, error } = await paged;
    assertNoQueryError(error);

    const limit = resolveLimit(pagination);
    const rows = ((data ?? []) as DebtFacility[]).map(normalizeFacility);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? toNextCursor(items[items.length - 1]?.id) : null;

    return { items, nextCursor };
  }

  async createFacility(input: CreateDebtFacilityInput): Promise<DebtFacility> {
    const { data, error } = await this.db
      .from('debt_facilities')
      .insert({
        organization_id: this.context.organizationId,
        facility_name: input.facilityName,
        facility_type: input.facilityType,
        lender_counterparty_id: input.lenderCounterpartyId,
        limit_amount: input.limitAmount,
        utilized_amount: '0.000000',
        currency_code: input.currencyCode,
        status: 'active'
      })
      .select('*')
      .single();

    assertNoQueryError(error);
    return normalizeFacility(data as DebtFacility);
  }

  async getSchedule(facilityId: string): Promise<DebtScheduleLine[]> {
    const { data, error } = await this.db
      .from('debt_schedules')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('debt_facility_id', facilityId)
      .order('due_date', { ascending: true });

    assertNoQueryError(error);
    return ((data ?? []) as DebtScheduleLine[]).map(normalizeScheduleLine);
  }
}
