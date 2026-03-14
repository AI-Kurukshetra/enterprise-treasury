import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { applyCursorPagination } from '@/repositories/base/query';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { PaginatedResult, PaginationInput } from '@/types/common';
import type { Account, AccountFilters, CreateAccountInput, UpdateAccountInput } from '@/types/accounts/types';
import { resolveLimit, toNextCursor } from '@/utils/pagination';

export class AccountsRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async list(filters: AccountFilters, pagination: PaginationInput): Promise<PaginatedResult<Account>> {
    let query = this.db.from('bank_accounts').select('*').eq('organization_id', this.context.organizationId);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.currencyCode) {
      query = query.eq('currency_code', filters.currencyCode);
    }
    if (filters.bankConnectionId) {
      query = query.eq('bank_connection_id', filters.bankConnectionId);
    }

    const paged = applyCursorPagination(query, pagination, { cursorColumn: 'created_at' });
    const { data, error } = await paged;
    assertNoQueryError(error);

    const limit = resolveLimit(pagination);
    const rows = ((data ?? []) as Account[]);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? toNextCursor(items[items.length - 1]?.created_at) : null;

    return { items, nextCursor };
  }

  async create(input: CreateAccountInput): Promise<Account> {
    const { data, error } = await this.db
      .from('bank_accounts')
      .insert({
        organization_id: this.context.organizationId,
        bank_connection_id: input.bankConnectionId,
        account_name: input.accountName,
        account_number_masked: input.accountNumberMasked,
        currency_code: input.currencyCode,
        status: 'active'
      })
      .select('*')
      .single();

    assertNoQueryError(error);
    return data as Account;
  }

  async getById(accountId: string): Promise<Account | null> {
    const { data, error } = await this.db
      .from('bank_accounts')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('id', accountId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as Account | null) ?? null;
  }

  async update(accountId: string, input: UpdateAccountInput): Promise<Account | null> {
    const payload: Record<string, unknown> = {};
    if (input.accountName) {
      payload.account_name = input.accountName;
    }
    if (input.status) {
      payload.status = input.status;
    }

    const { data, error } = await this.db
      .from('bank_accounts')
      .update(payload)
      .eq('organization_id', this.context.organizationId)
      .eq('id', accountId)
      .select('*')
      .maybeSingle();

    assertNoQueryError(error);
    return (data as Account | null) ?? null;
  }
}
