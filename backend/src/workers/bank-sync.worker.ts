import type { SupabaseClient } from '@supabase/supabase-js';
import { NotFoundError } from '@/errors/NotFoundError';
import { JobWorker } from '@/lib/job-queue/job-worker';
import type { Job } from '@/lib/job-queue/job-queue';
import { detectStatementFormat, type StatementFormat } from '@/lib/parsers';
import { logger } from '@/lib/logger';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { assertNoQueryError } from '@/repositories/base/execute';
import { IntegrationsService } from '@/services/integrations/service';
import { NotificationsService } from '@/services/notifications/service';
import { ImportProcessor } from '@/services/transactions/import-processor';
import { ReconciliationService } from '@/services/transactions/reconciliation-service';

export interface BankSyncWorkerPayload {
  connectionId: string;
  organizationId: string;
  fromDate?: string;
  importJobId?: string;
  sourceFilename?: string;
  fileContent?: string;
  format?: StatementFormat;
  storageBucket?: string;
  storagePath?: string;
  csvColumnMapping?: Record<string, string>;
  syncJobId?: string;
  initiatedByUserId?: string;
}

interface IntegrationSyncJobRow {
  id: string;
  organization_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'partial';
  error_details: Record<string, unknown> | null;
}

export class BankSyncWorker extends JobWorker<BankSyncWorkerPayload> {
  readonly type = 'bank.sync';
  readonly maxAttempts = 4;

  private readonly db: SupabaseClient;

  constructor(dbClient?: SupabaseClient) {
    super();
    this.db = dbClient ?? createServiceSupabaseClient();
  }

  override async handle(payload: BankSyncWorkerPayload, job: Job<BankSyncWorkerPayload>): Promise<void> {
    if (payload.importJobId) {
      await this.runImportFlow(payload, job);
      return;
    }

    await this.runConnectionSync(payload, job);
  }

  private async runImportFlow(payload: BankSyncWorkerPayload, job: Job<BankSyncWorkerPayload>): Promise<void> {
    const syncJob = payload.syncJobId ? await this.loadSyncJobById(payload.syncJobId, payload.organizationId) : null;

    if (syncJob) {
      await this.updateSyncJob(syncJob.id, payload.organizationId, {
        status: 'running',
        started_at: new Date().toISOString(),
        completed_at: null,
        error_details: {
          ...(syncJob.error_details ?? {}),
          queueJobId: job.id,
          importJobId: payload.importJobId
        }
      });
    }

    const fileContent = await this.loadFileContent(payload);
    const format = payload.format ?? detectStatementFormat(fileContent, payload.sourceFilename);
    const importProcessor = new ImportProcessor(this.db);
    const importJobId = payload.importJobId;
    if (!importJobId) {
      throw new NotFoundError('Import job id is required for direct bank statement processing');
    }
    const importResult = await importProcessor.processImport(importJobId, fileContent, format, {
      csvColumnMapping: payload.csvColumnMapping
    });
    const importJob = await this.loadImportJob(importJobId, payload.organizationId);
    const reconciliationService = new ReconciliationService({
      dbClient: this.db,
      actorUserId: 'job-worker',
      requestId: `job:${job.id}`
    });
    const reconciliation = await reconciliationService.autoReconcile(
      payload.organizationId,
      importJob.bank_account_id ?? undefined
    );

    if (syncJob) {
      await this.updateSyncJob(syncJob.id, payload.organizationId, {
        status: importResult.errors.length > 0 ? 'partial' : 'completed',
        completed_at: new Date().toISOString(),
        error_details: {
          ...(syncJob.error_details ?? {}),
          queueJobId: job.id,
          importJobId,
          import: {
            total: importResult.total,
            imported: importResult.imported,
            duplicates: importResult.duplicates,
            errors: importResult.errors.length,
            warnings: importResult.warnings.length
          },
          reconciliation
        }
      });
    }

    if (payload.connectionId) {
      const { error: updateConnectionError } = await this.db
        .from('bank_connections')
        .update({
          last_sync_at: new Date().toISOString()
        })
        .eq('id', payload.connectionId)
        .eq('organization_id', payload.organizationId);

      assertNoQueryError(updateConnectionError);
    }

    if (payload.initiatedByUserId) {
      const notifications = new NotificationsService({
        organizationId: payload.organizationId,
        userId: 'job-worker',
        requestId: `job:${job.id}`
      });
      await notifications.importCompleted(
        {
          id: importJobId,
          organizationId: payload.organizationId,
          status: importJob.status,
          sourceFilename: importJob.source_filename,
          totalRows: importJob.total_rows,
          processedRows: importJob.processed_rows,
          failedRows: importJob.failed_rows
        },
        payload.initiatedByUserId
      );
    }
  }

  private async runConnectionSync(payload: BankSyncWorkerPayload, job: Job<BankSyncWorkerPayload>): Promise<void> {
    const syncJob = await this.loadSyncJob(payload);

    await this.updateSyncJob(syncJob.id, payload.organizationId, {
      status: 'running',
      started_at: new Date().toISOString(),
      completed_at: null,
      error_details: {
        ...(syncJob.error_details ?? {}),
        queueJobId: job.id
      }
    });

    const integrationsService = new IntegrationsService({
      organizationId: payload.organizationId,
      userId: 'job-worker',
      requestId: `job:${job.id}`
    });

    try {
      const result = await integrationsService.runSync({
        connectionId: payload.connectionId,
        organizationId: payload.organizationId,
        fromDate: payload.fromDate,
        syncJobId: syncJob.id
      });

      await this.updateSyncJob(syncJob.id, payload.organizationId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_details: {
          ...(syncJob.error_details ?? {}),
          queueJobId: job.id,
          importJobId: result.importJobId,
          importedTransactions: result.importedTransactions,
          initiatedByUserId: payload.initiatedByUserId ?? null
        }
      });

      if (payload.initiatedByUserId) {
        const importJob = await this.loadImportJob(result.importJobId, payload.organizationId);
        const notifications = new NotificationsService({
          organizationId: payload.organizationId,
          userId: 'job-worker',
          requestId: `job:${job.id}`
        });
        await notifications.importCompleted(
          {
            id: result.importJobId,
            organizationId: payload.organizationId,
            status: importJob.status,
            sourceFilename: importJob.source_filename,
            totalRows: importJob.total_rows,
            processedRows: importJob.processed_rows,
            failedRows: importJob.failed_rows
          },
          payload.initiatedByUserId
        );
      }

      logger.log({
        level: 'info',
        message: 'bank_sync_completed',
        domain: 'job_worker',
        eventType: this.type,
        organizationId: payload.organizationId,
        data: {
          jobId: job.id,
          syncJobId: syncJob.id,
          importJobId: result.importJobId,
          importedTransactions: result.importedTransactions
        }
      });
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error('Unknown bank sync failure');

      await this.updateSyncJob(syncJob.id, payload.organizationId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_details: {
          ...(syncJob.error_details ?? {}),
          queueJobId: job.id,
          errorMessage: normalizedError.message,
          errorStack: normalizedError.stack ?? null
        }
      });

      logger.log({
        level: 'error',
        message: 'bank_sync_failed',
        domain: 'job_worker',
        eventType: this.type,
        organizationId: payload.organizationId,
        data: {
          jobId: job.id,
          syncJobId: syncJob.id,
          errorMessage: normalizedError.message
        }
      });

      throw normalizedError;
    }
  }

  private async loadSyncJob(payload: BankSyncWorkerPayload): Promise<IntegrationSyncJobRow> {
    const { data, error } = await this.db
      .from('integration_sync_jobs')
      .select('id,organization_id,status,error_details')
      .eq('organization_id', payload.organizationId)
      .eq('integration_type', 'bank')
      .contains('error_details', { connectionId: payload.connectionId })
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    assertNoQueryError(error);

    if (!data) {
      throw new NotFoundError('Integration sync job not found for bank connection', {
        connectionId: payload.connectionId
      });
    }

    return data as IntegrationSyncJobRow;
  }

  private async loadSyncJobById(syncJobId: string, organizationId: string): Promise<IntegrationSyncJobRow | null> {
    const { data, error } = await this.db
      .from('integration_sync_jobs')
      .select('id,organization_id,status,error_details')
      .eq('organization_id', organizationId)
      .eq('id', syncJobId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as IntegrationSyncJobRow | null) ?? null;
  }

  private async loadImportJob(
    importJobId: string,
    organizationId: string
  ): Promise<{
    bank_account_id: string | null;
    source_filename: string | null;
    status: string;
    total_rows: number;
    processed_rows: number;
    failed_rows: number;
  }> {
    const { data, error } = await this.db
      .from('bank_statement_import_jobs')
      .select('bank_account_id,source_filename,status,total_rows,processed_rows,failed_rows')
      .eq('organization_id', organizationId)
      .eq('id', importJobId)
      .single();

    assertNoQueryError(error);
    return data as {
      bank_account_id: string | null;
      source_filename: string | null;
      status: string;
      total_rows: number;
      processed_rows: number;
      failed_rows: number;
    };
  }

  private async loadFileContent(payload: BankSyncWorkerPayload): Promise<string> {
    if (payload.fileContent) {
      return payload.fileContent;
    }

    if (!payload.storageBucket || !payload.storagePath) {
      throw new NotFoundError('No import file content or storage path was provided for bank sync processing');
    }

    const { data, error } = await this.db.storage.from(payload.storageBucket).download(payload.storagePath);
    if (error) {
      throw error;
    }

    return data.text();
  }

  private async updateSyncJob(
    syncJobId: string,
    organizationId: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    const { error } = await this.db
      .from('integration_sync_jobs')
      .update(patch)
      .eq('id', syncJobId)
      .eq('organization_id', organizationId);

    assertNoQueryError(error);
  }
}
