import { ValidationError } from '@/errors/ValidationError';
import { sumDecimalStrings } from '@/lib/finance/decimal';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { assertNoQueryError } from '@/repositories/base/execute';
import { JobQueue } from '@/lib/job-queue/job-queue';
import { IntegrationsRepository } from '@/repositories/integrations/repository';
import type { CreateBankIntegrationInput } from '@/types/integrations/types';
import type { ServiceContext } from '@/services/context';

export class IntegrationsService {
  private readonly repository: IntegrationsRepository;
  private readonly context: ServiceContext;
  private readonly queue: JobQueue;

  constructor(context: ServiceContext, repository?: IntegrationsRepository, queue?: JobQueue) {
    this.context = context;
    this.repository = repository ?? new IntegrationsRepository({ organizationId: context.organizationId });
    this.queue = queue ?? new JobQueue();
  }

  listBanks() {
    return this.repository.listBanks();
  }

  createBank(input: CreateBankIntegrationInput) {
    return this.repository.createBank(input);
  }

  async triggerBankSync(connectionId: string) {
    const result = await this.repository.triggerSync(connectionId);
    await this.queue.enqueue(
      'bank.sync',
      {
        connectionId,
        organizationId: this.context.organizationId,
        initiatedByUserId: this.context.userId
      },
      {
        organizationId: this.context.organizationId,
        maxAttempts: 4
      }
    );
    return result;
  }

  listSyncJobs() {
    return this.repository.listSyncJobs();
  }

  async runSync(input: {
    connectionId: string;
    organizationId: string;
    fromDate?: string;
    syncJobId?: string;
  }): Promise<{ importJobId: string; importedTransactions: number }> {
    const db = createServiceSupabaseClient();
    const { data: accounts, error: accountError } = await db
      .from('bank_accounts')
      .select('id,currency_code,status')
      .eq('organization_id', input.organizationId)
      .eq('bank_connection_id', input.connectionId)
      .neq('status', 'closed');

    assertNoQueryError(accountError);

    const availableAccounts = (accounts ?? []) as Array<{
      id: string;
      currency_code: string;
      status: string;
    }>;

    if (availableAccounts.length === 0) {
      throw new ValidationError('No active bank accounts found for the requested connection', {
        connectionId: input.connectionId
      });
    }

    const sourceFilename = `mock-sync-${input.syncJobId ?? input.connectionId}.json`;
    const { data: existingImportJob, error: importLookupError } = await db
      .from('bank_statement_import_jobs')
      .select('id,status,processed_rows')
      .eq('organization_id', input.organizationId)
      .eq('bank_connection_id', input.connectionId)
      .eq('source_filename', sourceFilename)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    assertNoQueryError(importLookupError);

    const existingImport = (existingImportJob as { id: string; status: string; processed_rows: number } | null) ?? null;
    if (existingImport?.status === 'completed') {
      return {
        importJobId: existingImport.id,
        importedTransactions: existingImport.processed_rows
      };
    }

    let importJobId = existingImport?.id ?? null;

    if (!importJobId) {
      const { data: createdImportJob, error: createImportError } = await db
        .from('bank_statement_import_jobs')
        .insert({
          organization_id: input.organizationId,
          bank_connection_id: input.connectionId,
          status: 'running',
          source_filename: sourceFilename,
          started_at: new Date().toISOString()
        })
        .select('id')
        .single();

      assertNoQueryError(createImportError);
      importJobId = (createdImportJob as { id: string }).id;
    } else {
      const { error: updateImportError } = await db
        .from('bank_statement_import_jobs')
        .update({
          status: 'running',
          started_at: new Date().toISOString(),
          completed_at: null,
          error_summary: null
        })
        .eq('id', importJobId)
        .eq('organization_id', input.organizationId);

      assertNoQueryError(updateImportError);
    }

    const bookingDate = input.fromDate ?? new Date().toISOString().slice(0, 10);
    let importedTransactions = 0;
    const sourceSystem = 'mock_bank_api';
    const eventTimestamp = `${bookingDate}T00:00:00Z`;

    for (const [accountIndex, account] of availableAccounts.entries()) {
      let currentBalance = await this.getLatestRunningBalance(db, input.organizationId, account.id);
      const templates = [
        {
          amount: (1500 + accountIndex * 175).toFixed(6),
          direction: 'inflow' as const,
          description: 'Mock customer collection'
        },
        {
          amount: (720 + accountIndex * 110).toFixed(6),
          direction: 'outflow' as const,
          description: 'Mock supplier payment'
        }
      ];

      for (const [templateIndex, template] of templates.entries()) {
        const eventOrdinal = accountIndex * templates.length + templateIndex + 1;
        const sourceEventId = `${input.syncJobId ?? input.connectionId}:${account.id}:${eventOrdinal}`;
        const { data: existingSourceEvent, error: sourceEventError } = await db
          .from('transaction_source_events')
          .select('transaction_id')
          .eq('organization_id', input.organizationId)
          .eq('source_system', sourceSystem)
          .eq('source_event_id', sourceEventId)
          .maybeSingle();

        assertNoQueryError(sourceEventError);

        if (existingSourceEvent) {
          importedTransactions += 1;
          continue;
        }

        const dedupeHash = sourceEventId.replace(/:/g, '-');
        const signedAmount = template.direction === 'inflow' ? template.amount : `-${template.amount}`;
        const runningBalance = sumDecimalStrings([currentBalance, signedAmount]);
        const { error: transactionError } = await db.from('transactions').insert({
          organization_id: input.organizationId,
          bank_account_id: account.id,
          ingestion_job_id: importJobId,
          source_type: 'bank_import',
          source_system: sourceSystem,
          source_event_id: sourceEventId,
          event_sequence: eventOrdinal,
          event_timestamp: eventTimestamp,
          booking_date: bookingDate,
          value_date: bookingDate,
          amount: template.amount,
          currency_code: account.currency_code,
          direction: template.direction,
          description: template.description,
          dedupe_hash: dedupeHash,
          running_balance: runningBalance,
          raw_payload: {
            provider: 'mock',
            connectionId: input.connectionId,
            syncJobId: input.syncJobId ?? null
          }
        });

        assertNoQueryError(transactionError);
        currentBalance = runningBalance;
        importedTransactions += 1;
      }
    }

    const { error: completeImportError } = await db
      .from('bank_statement_import_jobs')
      .update({
        status: 'completed',
        total_rows: importedTransactions,
        processed_rows: importedTransactions,
        failed_rows: 0,
        completed_at: new Date().toISOString(),
        error_summary: {
          importedTransactions,
          mode: 'mock',
          note: 'TODO: replace with real bank API connector'
        }
      })
      .eq('id', importJobId)
      .eq('organization_id', input.organizationId);

    assertNoQueryError(completeImportError);

    const { error: updateConnectionError } = await db
      .from('bank_connections')
      .update({
        last_sync_at: new Date().toISOString()
      })
      .eq('id', input.connectionId)
      .eq('organization_id', input.organizationId);

    assertNoQueryError(updateConnectionError);

    return {
      importJobId,
      importedTransactions
    };
  }

  private async getLatestRunningBalance(
    db: ReturnType<typeof createServiceSupabaseClient>,
    organizationId: string,
    accountId: string
  ): Promise<string> {
    const { data, error } = await db
      .from('transactions')
      .select('running_balance,amount,direction')
      .eq('organization_id', organizationId)
      .eq('bank_account_id', accountId)
      .order('event_timestamp', { ascending: false })
      .order('booking_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    assertNoQueryError(error);

    if (!data) {
      return '0.000000';
    }

    const latest = data as { running_balance: string | null; amount: string; direction: 'inflow' | 'outflow' };
    if (latest.running_balance) {
      return latest.running_balance;
    }

    return latest.direction === 'inflow' ? latest.amount : `-${latest.amount}`;
  }
}
