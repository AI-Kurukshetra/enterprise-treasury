import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { assertNoQueryError } from '@/repositories/base/execute';
import { AppError } from '@/errors/AppError';
import { normalizeWhitespace } from '@/lib/parsers/shared';
import { NotificationsService } from '@/services/notifications/service';

interface TransactionRow {
  id: string;
  organization_id: string;
  bank_account_id: string;
  booking_date: string;
  value_date: string | null;
  amount: string;
  currency_code: string;
  direction: 'inflow' | 'outflow';
  description: string | null;
  reconciliation_status: 'unreconciled' | 'partially_reconciled' | 'reconciled' | 'exception';
}

interface PaymentRow {
  id: string;
  payment_reference: string;
  source_account_id: string;
  amount: string;
  currency_code: string;
  value_date: string;
  purpose: string | null;
  status: string;
}

interface ExpectedReceiptRow {
  id: string;
  receipt_reference: string;
  bank_account_id: string;
  amount: string;
  currency_code: string;
  expected_value_date: string;
  description: string | null;
  status: string;
}

export interface ReconciliationResult {
  reconciled: number;
  partial: number;
  exceptions: number;
}

function decimalToMicros(value: string): bigint {
  const [integerPart = '0', fractionRaw = ''] = value.split('.');
  const negative = integerPart.startsWith('-');
  const whole = BigInt(negative ? integerPart.slice(1) : integerPart);
  const fraction = BigInt(fractionRaw.padEnd(6, '0').slice(0, 6) || '0');
  const micros = whole * 1_000_000n + fraction;
  return negative ? -micros : micros;
}

function withinAmountTolerance(left: string, right: string, toleranceMicros: bigint): boolean {
  const delta = decimalToMicros(left) - decimalToMicros(right);
  return delta < 0 ? -delta <= toleranceMicros : delta <= toleranceMicros;
}

function diffDays(left: string, right: string): number {
  const leftMs = Date.parse(`${left}T00:00:00Z`);
  const rightMs = Date.parse(`${right}T00:00:00Z`);
  return Math.abs(Math.round((leftMs - rightMs) / 86_400_000));
}

function subtractBusinessDays(from: Date, businessDays: number): string {
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let remaining = businessDays;

  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return cursor.toISOString().slice(0, 10);
}

function buildSearchText(transaction: TransactionRow): string {
  return normalizeWhitespace(transaction.description ?? '').toLowerCase();
}

export class ReconciliationService {
  private readonly db: SupabaseClient;
  private readonly actorUserId?: string;
  private readonly requestId?: string;

  constructor(options: { dbClient?: SupabaseClient; actorUserId?: string; requestId?: string } = {}) {
    this.db = options.dbClient ?? createServiceSupabaseClient();
    this.actorUserId = options.actorUserId;
    this.requestId = options.requestId;
  }

  async autoReconcile(orgId: string, accountId?: string): Promise<ReconciliationResult> {
    const transactions = await this.listCandidateTransactions(orgId, accountId);
    const usedPaymentIds = await this.listUsedTargetIds(orgId, 'payment_id');
    const usedReceiptIds = await this.listUsedTargetIds(orgId, 'expected_receipt_id');
    let reconciled = 0;
    let partial = 0;
    let exceptions = 0;

    for (const transaction of transactions) {
      const searchText = buildSearchText(transaction);

      if (transaction.direction === 'outflow') {
        const payments = await this.listPaymentCandidates(orgId, transaction.bank_account_id);
        const exact = payments.find((payment) => {
          return (
            !usedPaymentIds.has(payment.id) &&
            payment.amount === transaction.amount &&
            payment.currency_code === transaction.currency_code &&
            payment.value_date === (transaction.value_date ?? transaction.booking_date) &&
            searchText.includes(payment.payment_reference.toLowerCase())
          );
        });

        if (exact) {
          usedPaymentIds.add(exact.id);
          await this.applyMatch(transaction, 'reconciled', 'exact', {
            paymentId: exact.id,
            reason: `Exact payment match for ${exact.payment_reference}`
          });
          reconciled += 1;
          continue;
        }

        const fuzzy = payments.find((payment) => {
          return (
            !usedPaymentIds.has(payment.id) &&
            payment.currency_code === transaction.currency_code &&
            withinAmountTolerance(payment.amount, transaction.amount, 10_000n) &&
            diffDays(payment.value_date, transaction.value_date ?? transaction.booking_date) <= 2
          );
        });

        if (fuzzy) {
          usedPaymentIds.add(fuzzy.id);
          await this.applyMatch(transaction, 'partially_reconciled', 'fuzzy', {
            paymentId: fuzzy.id,
            reason: `Fuzzy payment match for ${fuzzy.payment_reference}`
          });
          partial += 1;
          continue;
        }
      } else {
        const receipts = await this.listExpectedReceiptCandidates(orgId, transaction.bank_account_id);
        const exact = receipts.find((receipt) => {
          return (
            !usedReceiptIds.has(receipt.id) &&
            receipt.amount === transaction.amount &&
            receipt.currency_code === transaction.currency_code &&
            receipt.expected_value_date === (transaction.value_date ?? transaction.booking_date) &&
            searchText.includes(receipt.receipt_reference.toLowerCase())
          );
        });

        if (exact) {
          usedReceiptIds.add(exact.id);
          await this.applyMatch(transaction, 'reconciled', 'exact', {
            expectedReceiptId: exact.id,
            reason: `Exact receipt match for ${exact.receipt_reference}`
          });
          await this.updateExpectedReceiptStatus(orgId, exact.id, 'reconciled');
          reconciled += 1;
          continue;
        }

        const fuzzy = receipts.find((receipt) => {
          return (
            !usedReceiptIds.has(receipt.id) &&
            receipt.currency_code === transaction.currency_code &&
            withinAmountTolerance(receipt.amount, transaction.amount, 10_000n) &&
            diffDays(receipt.expected_value_date, transaction.value_date ?? transaction.booking_date) <= 2
          );
        });

        if (fuzzy) {
          usedReceiptIds.add(fuzzy.id);
          await this.applyMatch(transaction, 'partially_reconciled', 'fuzzy', {
            expectedReceiptId: fuzzy.id,
            reason: `Fuzzy receipt match for ${fuzzy.receipt_reference}`
          });
          await this.updateExpectedReceiptStatus(orgId, fuzzy.id, 'partially_reconciled');
          partial += 1;
          continue;
        }
      }

      if ((transaction.value_date ?? transaction.booking_date) <= subtractBusinessDays(new Date(), 5)) {
        await this.createException(orgId, transaction.id, 'No reconciliation match found within 5 business days');
        exceptions += 1;
      }
    }

    return {
      reconciled,
      partial,
      exceptions
    };
  }

  async createException(orgId: string, transactionId: string, reason: string): Promise<void> {
    const transaction = await this.getTransaction(orgId, transactionId);
    if (!transaction) {
      throw new AppError('Transaction not found for exception workflow', {
        statusCode: 404,
        code: 'TRANSACTION_NOT_FOUND'
      });
    }

    await this.applyMatch(transaction, 'exception', 'exception', { reason });
    await this.createNotification(orgId, {
      type: 'reconciliation_exception',
      message: `Transaction ${transactionId} requires treasury review: ${reason}`,
      entityType: 'transactions',
      entityId: transaction.id,
      metadata: {
        bookingDate: transaction.booking_date,
        amount: transaction.amount,
        currencyCode: transaction.currency_code
      }
    });
  }

  async getReconciliationStatus(orgId: string, fromDate: string, toDate: string): Promise<{
    total: number;
    reconciled: number;
    unreconciled: number;
    exceptions: number;
    rate: number;
  }> {
    const { data, error } = await this.db
      .from('transactions')
      .select('reconciliation_status')
      .eq('organization_id', orgId)
      .gte('booking_date', fromDate)
      .lte('booking_date', toDate);

    assertNoQueryError(error);
    const rows = (data ?? []) as Array<{ reconciliation_status: TransactionRow['reconciliation_status'] }>;
    const total = rows.length;
    const reconciled = rows.filter((row) => row.reconciliation_status === 'reconciled').length;
    const unreconciled = rows.filter((row) => row.reconciliation_status === 'unreconciled').length;
    const exceptions = rows.filter((row) => row.reconciliation_status === 'exception').length;

    return {
      total,
      reconciled,
      unreconciled,
      exceptions,
      rate: total === 0 ? 0 : Number(((reconciled / total) * 100).toFixed(2))
    };
  }

  private async listCandidateTransactions(orgId: string, accountId?: string): Promise<TransactionRow[]> {
    let query = this.db
      .from('transactions')
      .select('id,organization_id,bank_account_id,booking_date,value_date,amount,currency_code,direction,description,reconciliation_status')
      .eq('organization_id', orgId)
      .eq('reconciliation_status', 'unreconciled')
      .order('booking_date', { ascending: true })
      .limit(5000);

    if (accountId) {
      query = query.eq('bank_account_id', accountId);
    }

    const { data, error } = await query;
    assertNoQueryError(error);
    return (data ?? []) as TransactionRow[];
  }

  private async listPaymentCandidates(orgId: string, accountId: string): Promise<PaymentRow[]> {
    const { data, error } = await this.db
      .from('payments')
      .select('id,payment_reference,source_account_id,amount,currency_code,value_date,purpose,status')
      .eq('organization_id', orgId)
      .eq('source_account_id', accountId)
      .in('status', ['approved', 'sent', 'settled'])
      .order('value_date', { ascending: true })
      .limit(5000);

    assertNoQueryError(error);
    return (data ?? []) as PaymentRow[];
  }

  private async listExpectedReceiptCandidates(orgId: string, accountId: string): Promise<ExpectedReceiptRow[]> {
    const { data, error } = await this.db
      .from('expected_receipts')
      .select('id,receipt_reference,bank_account_id,amount,currency_code,expected_value_date,description,status')
      .eq('organization_id', orgId)
      .eq('bank_account_id', accountId)
      .in('status', ['open', 'partially_reconciled'])
      .order('expected_value_date', { ascending: true })
      .limit(5000);

    assertNoQueryError(error);
    return (data ?? []) as ExpectedReceiptRow[];
  }

  private async listUsedTargetIds(orgId: string, column: 'payment_id' | 'expected_receipt_id'): Promise<Set<string>> {
    const { data, error } = await this.db
      .from('transaction_reconciliations')
      .select(column)
      .eq('organization_id', orgId)
      .not(column, 'is', null);

    assertNoQueryError(error);
    return new Set(
      ((data ?? []) as Array<Record<string, string | null>>)
        .map((row) => row[column])
        .filter((value): value is string => Boolean(value))
    );
  }

  private async getTransaction(orgId: string, transactionId: string): Promise<TransactionRow | null> {
    const { data, error } = await this.db
      .from('transactions')
      .select('id,organization_id,bank_account_id,booking_date,value_date,amount,currency_code,direction,description,reconciliation_status')
      .eq('organization_id', orgId)
      .eq('id', transactionId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as TransactionRow | null) ?? null;
  }

  private async applyMatch(
    transaction: TransactionRow,
    status: TransactionRow['reconciliation_status'],
    matchType: 'exact' | 'fuzzy' | 'exception',
    options: {
      paymentId?: string;
      expectedReceiptId?: string;
      reason: string;
    }
  ): Promise<void> {
    const { error: updateError } = await this.db
      .from('transactions')
      .update({
        reconciliation_status: status
      })
      .eq('organization_id', transaction.organization_id)
      .eq('id', transaction.id)
      .eq('booking_date', transaction.booking_date);

    assertNoQueryError(updateError);

    const { error: insertError } = await this.db.from('transaction_reconciliations').insert({
      organization_id: transaction.organization_id,
      transaction_id: transaction.id,
      transaction_booking_date: transaction.booking_date,
      payment_id: options.paymentId ?? null,
      expected_receipt_id: options.expectedReceiptId ?? null,
      match_type: matchType,
      reason: options.reason,
      metadata: {
        transactionAmount: transaction.amount,
        currencyCode: transaction.currency_code,
        transactionDate: transaction.value_date ?? transaction.booking_date
      },
      created_by: this.actorUserId ?? null
    });

    assertNoQueryError(insertError);
    await this.writeAuditLog(transaction.organization_id, transaction.id, status, options.reason);
  }

  private async updateExpectedReceiptStatus(
    orgId: string,
    receiptId: string,
    status: 'partially_reconciled' | 'reconciled'
  ): Promise<void> {
    const { error } = await this.db
      .from('expected_receipts')
      .update({
        status,
        updated_by: this.actorUserId ?? null
      })
      .eq('organization_id', orgId)
      .eq('id', receiptId);

    assertNoQueryError(error);
  }

  private async createNotification(
    organizationId: string,
    input: {
      type: string;
      message: string;
      entityType: string;
      entityId: string;
      metadata: Record<string, unknown>;
    }
  ): Promise<void> {
    const notifications = new NotificationsService({
      organizationId,
      userId: this.actorUserId ?? 'system',
      requestId: this.requestId ?? `reconciliation:${organizationId}`
    });

    await notifications.notifyOrg(organizationId, {
      type: `system.${input.type}`,
      severity: 'warning',
      title: 'Reconciliation exception requires review',
      body: input.message,
      actionUrl: '/transactions',
      actionLabel: 'Review transaction',
      relatedEntityType: input.entityType,
      relatedEntityId: input.entityId
    });
  }

  private async writeAuditLog(
    organizationId: string,
    transactionId: string,
    status: string,
    reason: string
  ): Promise<void> {
    const { error } = await this.db.rpc('log_audit_event', {
      p_organization_id: organizationId,
      p_action: 'reconciliation.decision',
      p_entity_type: 'transactions',
      p_entity_id: transactionId,
      p_previous_state: null,
      p_new_state: {
        reconciliation_status: status,
        reason
      },
      p_user_id: this.actorUserId ?? null,
      p_metadata: {
        reason
      },
      p_source_channel: 'worker',
      p_request_id: this.requestId ?? null
    });

    assertNoQueryError(error);
  }
}
