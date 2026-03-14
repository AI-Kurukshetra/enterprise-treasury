import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { applyCursorPagination } from '@/repositories/base/query';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { PaginatedResult, PaginationInput } from '@/types/common';
import type { CreatePaymentInput, Payment, PaymentFilters, PaymentStatus } from '@/types/payments/types';
import { resolveLimit, toNextCursor } from '@/utils/pagination';

export class PaymentsRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async list(filters: PaymentFilters, pagination: PaginationInput): Promise<PaginatedResult<Payment>> {
    let query = this.db.from('payments').select('*').eq('organization_id', this.context.organizationId);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.accountId) {
      query = query.eq('source_account_id', filters.accountId);
    }
    if (filters.beneficiaryId) {
      query = query.eq('beneficiary_counterparty_id', filters.beneficiaryId);
    }
    if (filters.fromDate) {
      query = query.gte('value_date', filters.fromDate);
    }
    if (filters.toDate) {
      query = query.lte('value_date', filters.toDate);
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
    const rows = (data ?? []) as Payment[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? toNextCursor(items[items.length - 1]?.created_at) : null;

    return { items, nextCursor };
  }

  async findById(paymentId: string): Promise<Payment | null> {
    const { data, error } = await this.db
      .from('payments')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('id', paymentId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as Payment | null) ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Payment | null> {
    const { data, error } = await this.db
      .from('payments')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as Payment | null) ?? null;
  }

  async create(
    input: CreatePaymentInput,
    createdBy: string,
    idempotencyKey: string,
    requestId: string,
    approvalWorkflowId: string,
    options?: {
      status?: PaymentStatus;
      notes?: string | null;
    }
  ): Promise<Payment> {
    const { data, error } = await this.db
      .from('payments')
      .insert({
        organization_id: this.context.organizationId,
        payment_reference: input.paymentReference,
        source_account_id: input.sourceAccountId,
        beneficiary_counterparty_id: input.beneficiaryCounterpartyId,
        amount: input.amount,
        currency_code: input.currencyCode,
        value_date: input.valueDate,
        purpose: input.purpose ?? null,
        notes: options?.notes ?? null,
        status: options?.status ?? 'pending_approval',
        request_id: requestId,
        created_by: createdBy,
        approval_workflow_id: approvalWorkflowId,
        idempotency_key: idempotencyKey
      })
      .select('*')
      .single();

    assertNoQueryError(error);
    return data as Payment;
  }

  async updateStatus(
    paymentId: string,
    status: PaymentStatus,
    expectedVersion: number,
    failureReason?: string
  ): Promise<Payment | null> {
    const payload: Record<string, unknown> = { status };

    if (status === 'approved') {
      payload.approved_at = new Date().toISOString();
    }
    if (status === 'sent' || status === 'settled') {
      payload.executed_at = new Date().toISOString();
    }
    if (failureReason) {
      payload.failure_reason = failureReason;
    }

    const { data, error } = await this.db
      .from('payments')
      .update(payload)
      .eq('organization_id', this.context.organizationId)
      .eq('id', paymentId)
      .eq('version', expectedVersion)
      .select('*')
      .maybeSingle();

    assertNoQueryError(error);
    return (data as Payment | null) ?? null;
  }
}
