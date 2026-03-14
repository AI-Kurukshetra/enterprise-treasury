import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { detectStatementFormat, parseStatementDocument, type StatementFormat } from '@/lib/parsers';
import { chunkArray, getDecimalScale, isIsoCurrencyCode, normalizeCurrencyCode } from '@/lib/parsers/shared';
import type { CsvColumnMapping, ParsedTransaction } from '@/lib/parsers/types';
import { assertNoQueryError } from '@/repositories/base/execute';
import { sha256 } from '@/utils/hash';

interface ImportJobRow {
  id: string;
  organization_id: string;
  bank_connection_id: string;
  bank_account_id: string | null;
  source_filename: string | null;
}

interface BankAccountRow {
  id: string;
  organization_id: string;
  bank_connection_id: string | null;
  account_name: string;
  account_number_masked: string;
  iban: string | null;
  currency_code: string;
}

interface PreparedTransactionRow {
  organization_id: string;
  bank_account_id: string;
  ingestion_job_id: string;
  source_type: 'bank_import';
  source_system: string;
  source_event_id: string;
  event_sequence: number;
  event_timestamp: string;
  external_transaction_id: string | null;
  booking_date: string;
  value_date: string;
  amount: string;
  currency_code: string;
  direction: 'inflow' | 'outflow';
  description: string | null;
  reconciliation_status: 'unreconciled';
  dedupe_hash: string;
  raw_payload: Record<string, unknown>;
}

export interface ImportIssue {
  lineNumber: number;
  field: string;
  reason: string;
  rawValue?: string;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  errors: ImportIssue[];
  warnings: string[];
  total: number;
}

export class ImportProcessor {
  private readonly db: SupabaseClient;

  constructor(dbClient?: SupabaseClient) {
    this.db = dbClient ?? createServiceSupabaseClient();
  }

  async processImport(
    jobId: string,
    fileContent: string,
    format?: StatementFormat,
    options: {
      csvColumnMapping?: CsvColumnMapping;
    } = {}
  ): Promise<ImportResult> {
    const job = await this.getImportJob(jobId);
    const resolvedFormat = format ?? detectStatementFormat(fileContent, job.source_filename ?? undefined);
    const parsed = parseStatementDocument(fileContent, resolvedFormat, {
      csv: {
        columnMapping: options.csvColumnMapping
      }
    });
    const importErrors: ImportIssue[] = parsed.errors.map((error) => ({
      lineNumber: error.lineNumber,
      field: error.field,
      reason: error.reason,
      rawValue: error.rawValue
    }));
    const warnings = parsed.warnings.map((warning) => `${warning.field} @ line ${warning.lineNumber}: ${warning.reason}`);
    const insertedTransactions: Array<{ id: string; booking_date: string }> = [];

    await this.updateImportJob(job.id, {
      status: 'running',
      format: resolvedFormat,
      started_at: new Date().toISOString(),
      detected_account_identifier: parsed.statements[0]?.accountId ?? null
    });

    try {
      const preparedRows: PreparedTransactionRow[] = [];
      const sequenceState = new Map<string, number>();
      let sourceOrdinal = 0;

      for (const statement of parsed.statements) {
        const account = await this.resolveBankAccount(job, statement.accountId);
        if (!account) {
          importErrors.push({
            lineNumber: 1,
            field: 'accountId',
            reason: `Could not resolve bank account for statement account identifier "${statement.accountId || 'blank'}"`
          });
          continue;
        }

        for (const transaction of statement.transactions) {
          sourceOrdinal += 1;
          const prepared = this.prepareTransactionRow({
            job,
            account,
            statementCurrency: statement.currency,
            format: resolvedFormat,
            transaction,
            ordinal: sourceOrdinal
          });

          if ('error' in prepared) {
            importErrors.push(prepared.error);
            continue;
          }

          const sequenceKey = `${account.id}:${prepared.row.source_system}`;
          if (!sequenceState.has(sequenceKey)) {
            sequenceState.set(sequenceKey, await this.getLatestEventSequence(job.organization_id, account.id, prepared.row.source_system));
          }

          const nextSequence = (sequenceState.get(sequenceKey) ?? 0) + 1;
          sequenceState.set(sequenceKey, nextSequence);
          prepared.row.event_sequence = nextSequence;
          preparedRows.push(prepared.row);
        }
      }

      await this.updateImportJob(job.id, {
        total_records: preparedRows.length,
        total_rows: preparedRows.length
      });

      let imported = 0;
      let duplicates = 0;

      for (const batch of chunkArray(preparedRows, 500)) {
        const existingHashes = await this.findExistingDedupeHashes(job.organization_id, batch.map((row) => row.dedupe_hash));
        const insertable = batch.filter((row) => !existingHashes.has(row.dedupe_hash));
        duplicates += batch.length - insertable.length;

        if (insertable.length > 0) {
          try {
            const inserted = await this.insertTransactions(insertable);
            insertedTransactions.push(...inserted);
            imported += inserted.length;
          } catch {
            for (const row of insertable) {
              try {
                const inserted = await this.insertTransactions([row]);
                insertedTransactions.push(...inserted);
                imported += inserted.length;
              } catch (rowError) {
                importErrors.push({
                  lineNumber: Number((row.raw_payload.lineNumber as number | undefined) ?? 1),
                  field: 'transaction',
                  reason: rowError instanceof Error ? rowError.message : 'Transaction insert failed',
                  rawValue: JSON.stringify(row.raw_payload)
                });
              }
            }
          }
        }

        await this.updateImportJob(job.id, {
          processed_rows: imported + duplicates + importErrors.length,
          imported_count: imported,
          duplicate_count: duplicates,
          error_count: importErrors.length,
          failed_rows: importErrors.length
        });
      }

      const finalStatus = importErrors.length > 0 ? (imported > 0 ? 'partial' : 'failed') : 'completed';
      await this.updateImportJob(job.id, {
        status: finalStatus,
        completed_at: new Date().toISOString(),
        processed_rows: imported + duplicates + importErrors.length,
        imported_count: imported,
        duplicate_count: duplicates,
        error_count: importErrors.length,
        failed_rows: importErrors.length,
        warning_count: warnings.length,
        result_summary: {
          format: resolvedFormat,
          errors: importErrors,
          warnings
        },
        error_summary: {
          errors: importErrors,
          warnings
        }
      });

      return {
        imported,
        duplicates,
        errors: importErrors,
        warnings,
        total: preparedRows.length
      };
    } catch (error) {
      await this.rollbackImport(job.organization_id, job.id, insertedTransactions);
      const failureError = {
        lineNumber: 1,
        field: 'import',
        reason: error instanceof Error ? error.message : 'Unexpected import failure'
      };

      await this.updateImportJob(job.id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_count: importErrors.length + 1,
        failed_rows: importErrors.length + 1,
        result_summary: {
          errors: [...importErrors, failureError],
          warnings
        },
        error_summary: {
          errors: [...importErrors, failureError],
          warnings
        }
      });
      throw error;
    }
  }

  private async getImportJob(jobId: string): Promise<ImportJobRow> {
    const { data, error } = await this.db
      .from('bank_statement_import_jobs')
      .select('id,organization_id,bank_connection_id,bank_account_id,source_filename')
      .eq('id', jobId)
      .single();

    assertNoQueryError(error);
    return data as ImportJobRow;
  }

  private async resolveBankAccount(job: ImportJobRow, statementAccountId: string): Promise<BankAccountRow | null> {
    if (job.bank_account_id) {
      const { data, error } = await this.db
        .from('bank_accounts')
        .select('id,organization_id,bank_connection_id,account_name,account_number_masked,iban,currency_code')
        .eq('organization_id', job.organization_id)
        .eq('id', job.bank_account_id)
        .maybeSingle();

      assertNoQueryError(error);
      return (data as BankAccountRow | null) ?? null;
    }

    const sanitized = statementAccountId.trim();
    if (!sanitized) {
      return null;
    }

    const lastFour = sanitized.slice(-4);
    let query = this.db
      .from('bank_accounts')
      .select('id,organization_id,bank_connection_id,account_name,account_number_masked,iban,currency_code')
      .eq('organization_id', job.organization_id)
      .eq('bank_connection_id', job.bank_connection_id)
      .limit(10);

    if (lastFour.length === 4) {
      query = query.or(`iban.eq.${sanitized},account_number_masked.ilike.%${lastFour}`);
    } else {
      query = query.eq('iban', sanitized);
    }

    const { data, error } = await query;
    assertNoQueryError(error);
    return ((data ?? []) as BankAccountRow[])[0] ?? null;
  }

  private prepareTransactionRow(input: {
    job: ImportJobRow;
    account: BankAccountRow;
    statementCurrency: string;
    format: StatementFormat;
    transaction: ParsedTransaction;
    ordinal: number;
  }): { row: PreparedTransactionRow } | { error: ImportIssue } {
    const { job, account, statementCurrency, format, transaction, ordinal } = input;
    const currencyCode = normalizeCurrencyCode(transaction.currency ?? statementCurrency ?? account.currency_code) || account.currency_code;

    if (!isIsoCurrencyCode(currencyCode)) {
      return {
        error: {
          lineNumber: ordinal,
          field: 'currency',
          reason: `Invalid currency code "${currencyCode || 'blank'}"`,
          rawValue: JSON.stringify(transaction.raw)
        }
      };
    }

    if (getDecimalScale(transaction.amount) > 6) {
      return {
        error: {
          lineNumber: ordinal,
          field: 'amount',
          reason: 'Amount exceeds 6 decimal places',
          rawValue: transaction.amount
        }
      };
    }

    if (currencyCode !== account.currency_code) {
      return {
        error: {
          lineNumber: ordinal,
          field: 'currency',
          reason: `Statement currency ${currencyCode} does not match bank account currency ${account.currency_code}`,
          rawValue: transaction.amount
        }
      };
    }

    const bankReference = transaction.bankReference?.trim() || transaction.reference?.trim() || `${job.id}:${ordinal}`;
    const dedupeHash = sha256(
      [job.organization_id, account.id, transaction.bookingDate, transaction.amount, transaction.direction, bankReference].join('|')
    );

    return {
      row: {
        organization_id: job.organization_id,
        bank_account_id: account.id,
        ingestion_job_id: job.id,
        source_type: 'bank_import',
        source_system: `bank_${format}`,
        source_event_id: bankReference,
        event_sequence: 0,
        event_timestamp: `${transaction.valueDate}T00:00:00.000Z`,
        external_transaction_id: transaction.bankReference ?? transaction.reference ?? null,
        booking_date: transaction.bookingDate,
        value_date: transaction.valueDate,
        amount: transaction.amount,
        currency_code: currencyCode,
        direction: transaction.direction,
        description: transaction.description ?? transaction.remittanceInfo ?? null,
        reconciliation_status: 'unreconciled',
        dedupe_hash: dedupeHash,
        raw_payload: {
          lineNumber: ordinal,
          parsed: transaction.raw,
          remittanceInfo: transaction.remittanceInfo ?? null,
          swiftTransactionTypeCode: transaction.swiftTransactionTypeCode ?? null,
          reference: transaction.reference ?? null,
          bankReference: transaction.bankReference ?? null
        }
      }
    };
  }

  private async getLatestEventSequence(organizationId: string, accountId: string, sourceSystem: string): Promise<number> {
    const { data, error } = await this.db
      .from('transactions')
      .select('event_sequence')
      .eq('organization_id', organizationId)
      .eq('bank_account_id', accountId)
      .eq('source_system', sourceSystem)
      .order('event_sequence', { ascending: false })
      .limit(1);

    assertNoQueryError(error);
    return Number(((data ?? []) as Array<{ event_sequence: number | null }>)[0]?.event_sequence ?? 0);
  }

  private async findExistingDedupeHashes(organizationId: string, hashes: string[]): Promise<Set<string>> {
    if (hashes.length === 0) {
      return new Set<string>();
    }

    const { data, error } = await this.db
      .from('transaction_dedupe_keys')
      .select('dedupe_hash')
      .eq('organization_id', organizationId)
      .in('dedupe_hash', hashes);

    assertNoQueryError(error);
    return new Set(((data ?? []) as Array<{ dedupe_hash: string }>).map((item) => item.dedupe_hash));
  }

  private async insertTransactions(rows: PreparedTransactionRow[]): Promise<Array<{ id: string; booking_date: string }>> {
    const { data, error } = await this.db
      .from('transactions')
      .insert(rows)
      .select('id,booking_date');

    assertNoQueryError(error);
    return (data ?? []) as Array<{ id: string; booking_date: string }>;
  }

  private async rollbackImport(
    organizationId: string,
    jobId: string,
    insertedTransactions: Array<{ id: string; booking_date: string }>
  ): Promise<void> {
    if (insertedTransactions.length === 0) {
      return;
    }

    const transactionIds = insertedTransactions.map((transaction) => transaction.id);
    const bookingDates = insertedTransactions.map((transaction) => transaction.booking_date);
    let transactionDelete = this.db
      .from('transactions')
      .delete()
      .eq('organization_id', organizationId)
      .eq('ingestion_job_id', jobId);

    if (bookingDates.length > 0) {
      transactionDelete = transactionDelete.in('booking_date', bookingDates);
    }

    const { error: deleteTransactionsError } = await transactionDelete;
    assertNoQueryError(deleteTransactionsError);

    const { error: deleteDedupeError } = await this.db
      .from('transaction_dedupe_keys')
      .delete()
      .eq('organization_id', organizationId)
      .in('transaction_id', transactionIds);

    assertNoQueryError(deleteDedupeError);

    const { error: deleteSourceEventsError } = await this.db
      .from('transaction_source_events')
      .delete()
      .eq('organization_id', organizationId)
      .in('transaction_id', transactionIds);

    assertNoQueryError(deleteSourceEventsError);
  }

  private async updateImportJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
    const { error } = await this.db.from('bank_statement_import_jobs').update(payload).eq('id', jobId);
    assertNoQueryError(error);
  }
}
