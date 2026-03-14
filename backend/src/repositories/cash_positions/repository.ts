import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { CashPosition } from '@/types/cash_positions/types';
import { coerceDecimalString, coerceString } from '@/utils/database';
import { subtractAmounts } from '@/utils/money';

export interface LatestCashPositionFilters {
  scopeType: CashPosition['scope_type'];
  scopeId?: string;
  currencyCode?: string;
}

function normalizeCashPosition(row: CashPosition): CashPosition {
  const source = row as unknown as Record<string, unknown>;
  const currentBalance = coerceDecimalString(source.current_balance);
  const availableBalance = coerceDecimalString(source.available_balance);

  return {
    ...row,
    current_balance: currentBalance,
    available_balance: availableBalance,
    restricted_balance: coerceString(source.restricted_balance) ?? subtractAmounts(currentBalance, availableBalance)
  };
}

export class CashPositionsRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async getLatest(filters: LatestCashPositionFilters): Promise<CashPosition[]> {
    let query = this.db
      .from('cash_positions_latest')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('scope_type', filters.scopeType)
      .order('currency_code', { ascending: true });

    if (filters.scopeId) {
      query = query.eq('scope_id', filters.scopeId);
    }
    if (filters.currencyCode) {
      query = query.eq('currency_code', filters.currencyCode);
    }

    const { data, error } = await query;
    assertNoQueryError(error);
    return ((data ?? []) as CashPosition[]).map(normalizeCashPosition);
  }

  async getLatestByScopeIds(scopeType: CashPosition['scope_type'], scopeIds: string[]): Promise<CashPosition[]> {
    if (scopeIds.length === 0) {
      return [];
    }

    const { data, error } = await this.db
      .from('cash_positions_latest')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('scope_type', scopeType)
      .in('scope_id', scopeIds);

    assertNoQueryError(error);
    return ((data ?? []) as CashPosition[]).map(normalizeCashPosition);
  }

  async getHistory(scopeType: CashPosition['scope_type'], scopeId: string, fromIso: string, toIso: string): Promise<CashPosition[]> {
    const { data, error } = await this.db
      .from('cash_positions')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('scope_type', scopeType)
      .eq('scope_id', scopeId)
      .gte('as_of_at', fromIso)
      .lte('as_of_at', toIso)
      .order('as_of_at', { ascending: true });

    assertNoQueryError(error);
    return ((data ?? []) as CashPosition[]).map(normalizeCashPosition);
  }

  async getLatestSnapshotAge(scopeType: CashPosition['scope_type'], scopeId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('cash_positions_latest')
      .select('as_of_at')
      .eq('organization_id', this.context.organizationId)
      .eq('scope_type', scopeType)
      .eq('scope_id', scopeId)
      .order('as_of_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as { as_of_at: string } | null)?.as_of_at ?? null;
  }
}
