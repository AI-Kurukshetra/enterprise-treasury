import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { applyCursorPagination } from '@/repositories/base/query';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { PaginatedResult, PaginationInput } from '@/types/common';
import type { CreateTransactionInput, Transaction, TransactionFilters, TransactionImportStatus } from '@/types/transactions/types';
import { resolveLimit, toNextCursor } from '@/utils/pagination';

export class TransactionsRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async list(filters: TransactionFilters, pagination: PaginationInput): Promise<PaginatedResult<Transaction>> {
    let query = this.db.from('transactions').select('*').eq('organization_id', this.context.organizationId);

    if (filters.accountId) {
      query = query.eq('bank_account_id', filters.accountId);
    }
    if (filters.direction) {
      query = query.eq('direction', filters.direction);
    }
    if (filters.reconciliationStatus) {
      query = query.eq('reconciliation_status', filters.reconciliationStatus);
    }
    if (filters.fromDate) {
      query = query.gte('booking_date', filters.fromDate);
    }
    if (filters.toDate) {
      query = query.lte('booking_date', filters.toDate);
    }
    if (filters.minAmount) {
      query = query.gte('amount', filters.minAmount);
    }
    if (filters.maxAmount) {
      query = query.lte('amount', filters.maxAmount);
    }

    const paged = applyCursorPagination(query, pagination, { cursorColumn: 'created_at' });
    const { data, error } = await paged;
    assertNoQueryError(error);

    const limit = resolveLimit(pagination);
    const rows = (data ?? []) as Transaction[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? toNextCursor(items[items.length - 1]?.created_at) : null;

    return { items, nextCursor };
  }

  async findByDedupeHash(dedupeHash: string): Promise<Transaction | null> {
    const { data, error } = await this.db
      .from('transactions')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('dedupe_hash', dedupeHash)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as Transaction | null) ?? null;
  }

  async create(input: CreateTransactionInput): Promise<Transaction> {
    const { data, error } = await this.db
      .from('transactions')
      .insert({
        organization_id: this.context.organizationId,
        bank_account_id: input.bankAccountId,
        booking_date: input.bookingDate,
        value_date: input.valueDate ?? null,
        amount: input.amount,
        currency_code: input.currencyCode,
        direction: input.direction,
        description: input.description ?? null,
        dedupe_hash: input.dedupeHash,
        reconciliation_status: 'unreconciled'
      })
      .select('*')
      .single();

    assertNoQueryError(error);
    return data as Transaction;
  }

  async queueImport(input: {
    bankConnectionId: string;
    sourceFilename: string;
    bankAccountId?: string;
    format?: 'mt940' | 'csv' | 'ofx';
  }): Promise<{ importJobId: string; status: 'queued' }> {
    const { data, error } = await this.db
      .from('bank_statement_import_jobs')
      .insert({
        organization_id: this.context.organizationId,
        bank_connection_id: input.bankConnectionId,
        bank_account_id: input.bankAccountId ?? null,
        status: 'queued',
        source_filename: input.sourceFilename,
        format: input.format ?? null
      })
      .select('id')
      .single();

    assertNoQueryError(error);
    return {
      importJobId: (data as { id: string }).id,
      status: 'queued'
    };
  }

  async getImportJobStatus(jobId: string): Promise<TransactionImportStatus | null> {
    const { data, error } = await this.db
      .from('bank_statement_import_jobs')
      .select(
        'id,status,total_records,imported_count,duplicate_count,error_count,warning_count,result_summary,error_summary,created_at,updated_at'
      )
      .eq('organization_id', this.context.organizationId)
      .eq('id', jobId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as TransactionImportStatus | null) ?? null;
  }

  async reconcile(transactionId: string): Promise<Transaction | null> {
    const { data, error } = await this.db
      .from('transactions')
      .update({ reconciliation_status: 'reconciled' })
      .eq('organization_id', this.context.organizationId)
      .eq('id', transactionId)
      .select('*')
      .maybeSingle();

    assertNoQueryError(error);
    return (data as Transaction | null) ?? null;
  }
}
