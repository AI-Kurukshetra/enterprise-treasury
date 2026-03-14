import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { assertNoQueryError } from '@/repositories/base/execute';
import type {
  CashSummaryReport,
  ComplianceReportRecord,
  ComplianceReportRequest,
  LiquidityReport
} from '@/types/reports/types';

interface ComplianceReportRow {
  id: string;
  report_type: ComplianceReportRecord['reportType'];
  period_start: string;
  period_end: string;
  status: ComplianceReportRecord['status'];
  artifact_uri: string | null;
  created_at: string;
  updated_at: string;
}

export class ReportsRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async getCashSummary(periodStart: string, periodEnd: string): Promise<CashSummaryReport> {
    const { data, error } = await this.db.rpc('report_cash_summary', {
      p_organization_id: this.context.organizationId,
      p_period_start: periodStart,
      p_period_end: periodEnd
    });

    assertNoQueryError(error);
    return data as CashSummaryReport;
  }

  async getLiquidityReport(asOf: string): Promise<LiquidityReport> {
    const { data, error } = await this.db.rpc('report_liquidity', {
      p_organization_id: this.context.organizationId,
      p_as_of: `${asOf}T23:59:59.999Z`
    });

    assertNoQueryError(error);
    return data as LiquidityReport;
  }

  async generateCompliancePayload(input: ComplianceReportRequest): Promise<Record<string, unknown>> {
    const { data, error } = await this.db.rpc('report_compliance_package', {
      p_organization_id: this.context.organizationId,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_report_type: input.reportType
    });

    assertNoQueryError(error);
    return data as Record<string, unknown>;
  }

  async createComplianceReport(
    input: ComplianceReportRequest,
    artifactUri?: string | null,
    status: ComplianceReportRecord['status'] = 'generated'
  ): Promise<ComplianceReportRecord> {
    const { data, error } = await this.db
      .from('compliance_reports')
      .insert({
        organization_id: this.context.organizationId,
        report_type: input.reportType,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        status,
        artifact_uri: artifactUri ?? null
      })
      .select('id,report_type,period_start,period_end,status,artifact_uri,created_at,updated_at')
      .single();

    assertNoQueryError(error);
    return this.mapComplianceReportRow(data as ComplianceReportRow);
  }

  async listComplianceReports(): Promise<ComplianceReportRecord[]> {
    const { data, error } = await this.db
      .from('compliance_reports')
      .select('id,report_type,period_start,period_end,status,artifact_uri,created_at,updated_at')
      .eq('organization_id', this.context.organizationId)
      .order('created_at', { ascending: false });

    assertNoQueryError(error);
    return ((data ?? []) as ComplianceReportRow[]).map((row) => this.mapComplianceReportRow(row));
  }

  async getComplianceReportById(reportId: string): Promise<ComplianceReportRecord | null> {
    const { data, error } = await this.db
      .from('compliance_reports')
      .select('id,report_type,period_start,period_end,status,artifact_uri,created_at,updated_at')
      .eq('organization_id', this.context.organizationId)
      .eq('id', reportId)
      .maybeSingle();

    assertNoQueryError(error);
    return data ? this.mapComplianceReportRow(data as ComplianceReportRow) : null;
  }

  async logAuditEvent(input: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    requestId?: string | null;
  }): Promise<void> {
    const { error } = await this.db.rpc('log_audit_event', {
      p_organization_id: this.context.organizationId,
      p_action: input.action,
      p_entity_type: input.entityType,
      p_entity_id: input.entityId ?? null,
      p_previous_state: null,
      p_new_state: null,
      p_user_id: input.actorUserId,
      p_metadata: input.metadata ?? {},
      p_source_channel: 'api',
      p_request_id: input.requestId ?? null
    });

    assertNoQueryError(error);
  }

  private mapComplianceReportRow(row: ComplianceReportRow): ComplianceReportRecord {
    return {
      id: row.id,
      reportType: row.report_type,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      status: row.status,
      artifactUri: row.artifact_uri,
      downloadUrl: row.artifact_uri ?? `/api/v1/reports/compliance?downloadId=${row.id}`,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
