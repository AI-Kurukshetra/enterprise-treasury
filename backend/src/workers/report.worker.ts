import type { SupabaseClient } from '@supabase/supabase-js';
import { JobWorker } from '@/lib/job-queue/job-worker';
import type { Job } from '@/lib/job-queue/job-queue';
import { logger } from '@/lib/logger';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { assertNoQueryError } from '@/repositories/base/execute';

export interface ReportWorkerPayload {
  reportType: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  format: 'json' | 'csv';
}

interface ComplianceReportRow {
  id: string;
}

export class ReportWorker extends JobWorker<ReportWorkerPayload> {
  readonly type = 'report.generate';
  readonly maxAttempts = 3;

  private readonly db: SupabaseClient;

  constructor(dbClient?: SupabaseClient) {
    super();
    this.db = dbClient ?? createServiceSupabaseClient();
  }

  override async handle(payload: ReportWorkerPayload, job: Job<ReportWorkerPayload>): Promise<void> {
    const dataset = await this.buildDataset(payload);
    const formatted = payload.format === 'csv' ? this.toCsvReport(dataset) : dataset;
    const reportId = await this.upsertReport(payload, formatted);

    logger.log({
      level: 'info',
      message: 'Compliance report generated',
      domain: 'report_worker',
      eventType: 'report.generated',
      organizationId: payload.organizationId,
      data: {
        jobId: job.id,
        reportId,
        reportType: payload.reportType,
        format: payload.format
      }
    });
  }

  private async buildDataset(payload: ReportWorkerPayload): Promise<Record<string, unknown>> {
    switch (payload.reportType) {
      case 'cash-summary': {
        const { data, error } = await this.db
          .from('cash_positions_latest')
          .select('scope_type,scope_id,currency_code,available_balance,current_balance,restricted_balance,as_of_at')
          .eq('organization_id', payload.organizationId)
          .lte('as_of_at', `${payload.periodEnd}T23:59:59Z`);

        assertNoQueryError(error);
        return {
          reportType: payload.reportType,
          periodStart: payload.periodStart,
          periodEnd: payload.periodEnd,
          rows: data ?? []
        };
      }
      case 'liquidity': {
        const [poolResult, ruleResult] = await Promise.all([
          this.db
            .from('liquidity_pools')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', payload.organizationId),
          this.db
            .from('sweeping_rules')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', payload.organizationId)
            .eq('is_active', true)
        ]);

        assertNoQueryError(poolResult.error);
        assertNoQueryError(ruleResult.error);

        return {
          reportType: payload.reportType,
          periodStart: payload.periodStart,
          periodEnd: payload.periodEnd,
          poolCount: poolResult.count ?? 0,
          activeSweepRules: ruleResult.count ?? 0
        };
      }
      default: {
        const { data, error } = await this.db
          .from('transactions')
          .select('booking_date,currency_code,direction,amount,description')
          .eq('organization_id', payload.organizationId)
          .gte('booking_date', payload.periodStart)
          .lte('booking_date', payload.periodEnd)
          .order('booking_date', { ascending: true })
          .limit(500);

        assertNoQueryError(error);
        return {
          reportType: payload.reportType,
          periodStart: payload.periodStart,
          periodEnd: payload.periodEnd,
          rows: data ?? []
        };
      }
    }
  }

  private async upsertReport(payload: ReportWorkerPayload, reportResult: Record<string, unknown>): Promise<string> {
    const { data: existing, error: existingError } = await this.db
      .from('compliance_reports')
      .select('id')
      .eq('organization_id', payload.organizationId)
      .eq('report_type', payload.reportType)
      .eq('period_start', payload.periodStart)
      .eq('period_end', payload.periodEnd)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    assertNoQueryError(existingError);

    if (existing) {
      const { error } = await this.db
        .from('compliance_reports')
        .update({
          status: 'generated',
          result_payload: reportResult
        })
        .eq('id', (existing as ComplianceReportRow).id);

      assertNoQueryError(error);
      return (existing as ComplianceReportRow).id;
    }

    const { data, error } = await this.db
      .from('compliance_reports')
      .insert({
        organization_id: payload.organizationId,
        report_type: payload.reportType,
        period_start: payload.periodStart,
        period_end: payload.periodEnd,
        status: 'generated',
        result_payload: reportResult
      })
      .select('id')
      .single();

    assertNoQueryError(error);
    return (data as ComplianceReportRow).id;
  }

  private toCsvReport(dataset: Record<string, unknown>): Record<string, unknown> {
    const rows = Array.isArray(dataset.rows) ? (dataset.rows as Record<string, unknown>[]) : [dataset];
    if (rows.length === 0) {
      return {
        format: 'csv',
        content: ''
      };
    }

    const headers = Object.keys(rows[0] ?? {});
    const lines = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((header) => {
            const value = row[header];
            const serialized = value == null ? '' : String(value);
            return `"${serialized.replaceAll('"', '""')}"`;
          })
          .join(',')
      )
    ];

    return {
      format: 'csv',
      content: lines.join('\n')
    };
  }
}
