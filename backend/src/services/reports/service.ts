import { ReportsRepository } from '@/repositories/reports/repository';
import { NotFoundError } from '@/errors/NotFoundError';
import type { ServiceContext } from '@/services/context';
import type {
  CashSummaryReport,
  ComplianceReport,
  ComplianceReportRecord,
  ComplianceReportRequest,
  LiquidityReport
} from '@/types/reports/types';

export class ReportsService {
  private readonly context: ServiceContext;
  private readonly repository: ReportsRepository;

  constructor(context: ServiceContext, repository?: ReportsRepository) {
    this.context = context;
    this.repository = repository ?? new ReportsRepository({ organizationId: context.organizationId });
  }

  async getCashSummary(periodStart?: string, periodEnd?: string): Promise<CashSummaryReport> {
    const resolvedPeriodEnd = periodEnd ?? new Date().toISOString().slice(0, 10);
    const resolvedPeriodStart =
      periodStart ?? new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    return this.generateCashSummary(this.context.organizationId, resolvedPeriodStart, resolvedPeriodEnd);
  }

  async getLiquidity(asOf?: string): Promise<LiquidityReport> {
    return this.generateLiquidityReport(
      this.context.organizationId,
      asOf ?? new Date().toISOString().slice(0, 10)
    );
  }

  async generateCashSummary(orgId: string, periodStart: string, periodEnd: string): Promise<CashSummaryReport> {
    if (orgId !== this.context.organizationId) {
      throw new NotFoundError('Organization context mismatch for cash summary');
    }

    return this.repository.getCashSummary(periodStart, periodEnd);
  }

  async generateLiquidityReport(orgId: string, asOf: string): Promise<LiquidityReport> {
    if (orgId !== this.context.organizationId) {
      throw new NotFoundError('Organization context mismatch for liquidity report');
    }

    return this.repository.getLiquidityReport(asOf);
  }

  async generateComplianceReport(
    orgId: string,
    periodStart: string,
    periodEnd: string,
    reportType: ComplianceReportRequest['reportType'],
    format: ComplianceReportRequest['format'] = 'json'
  ): Promise<ComplianceReport> {
    if (orgId !== this.context.organizationId) {
      throw new NotFoundError('Organization context mismatch for compliance report');
    }

    const input: ComplianceReportRequest = {
      reportType,
      periodStart,
      periodEnd,
      format
    };
    const payload = await this.repository.generateCompliancePayload(input);
    const record = await this.repository.createComplianceReport(input, null, 'generated');
    const finalDownloadUrl = `/api/v1/reports/compliance?downloadId=${record.id}`;

    return {
      reportId: record.id,
      jobId: record.id,
      reportType,
      periodStart,
      periodEnd,
      status: 'generated',
      downloadUrl: finalDownloadUrl,
      payload
    };
  }

  listComplianceReports(): Promise<ComplianceReportRecord[]> {
    return this.repository.listComplianceReports();
  }

  async getComplianceReportDownload(reportId: string): Promise<{ record: ComplianceReportRecord; payload: Record<string, unknown> }> {
    const record = await this.repository.getComplianceReportById(reportId);
    if (!record) {
      throw new NotFoundError('Compliance report not found');
    }

    const payload = await this.repository.generateCompliancePayload({
      reportType: record.reportType,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      format: 'json'
    });

    return {
      record: {
        ...record,
        downloadUrl: `/api/v1/reports/compliance?downloadId=${record.id}`
      },
      payload
    };
  }

  async logReportDownload(input: {
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.repository.logAuditEvent({
      actorUserId: this.context.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
      requestId: this.context.requestId
    });
  }
}
