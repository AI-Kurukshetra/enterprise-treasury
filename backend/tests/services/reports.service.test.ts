import { describe, expect, it, vi } from 'vitest';
import { ReportsService } from '@/services/reports/service';
import type { ReportsRepository } from '@/repositories/reports/repository';

describe('ReportsService', () => {
  it('delegates cash and liquidity report generation to the repository layer', async () => {
    const getCashSummary = vi.fn().mockResolvedValue({ generatedAt: '2026-03-14T00:00:00.000Z' });
    const getLiquidityReport = vi.fn().mockResolvedValue({ generatedAt: '2026-03-14T00:00:00.000Z' });
    const repository = {
      getCashSummary,
      getLiquidityReport
    } as unknown as ReportsRepository;

    const service = new ReportsService(
      { organizationId: 'org-1', userId: 'user-1', requestId: 'req-1' },
      repository
    );

    await service.generateCashSummary('org-1', '2026-03-01', '2026-03-14');
    await service.generateLiquidityReport('org-1', '2026-03-14');

    expect(getCashSummary).toHaveBeenCalledWith('2026-03-01', '2026-03-14');
    expect(getLiquidityReport).toHaveBeenCalledWith('2026-03-14');
  });

  it('creates generated compliance reports with deterministic download routes', async () => {
    const generateCompliancePayload = vi.fn().mockResolvedValue({ summary: { paymentsReviewed: 4 } });
    const createComplianceReport = vi.fn().mockResolvedValue({
      id: '4e9c0600-4598-404f-932a-58e06b832d1d',
      reportType: 'audit',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-14',
      status: 'generated',
      artifactUri: null,
      downloadUrl: '/api/v1/reports/compliance?downloadId=4e9c0600-4598-404f-932a-58e06b832d1d',
      createdAt: '2026-03-14T10:00:00.000Z',
      updatedAt: '2026-03-14T10:00:00.000Z'
    });
    const repository = {
      generateCompliancePayload,
      createComplianceReport
    } as unknown as ReportsRepository;

    const service = new ReportsService(
      { organizationId: 'org-1', userId: 'user-1', requestId: 'req-1' },
      repository
    );

    const report = await service.generateComplianceReport('org-1', '2026-03-01', '2026-03-14', 'audit');

    expect(report.jobId).toBe(report.reportId);
    expect(report.downloadUrl).toBe('/api/v1/reports/compliance?downloadId=4e9c0600-4598-404f-932a-58e06b832d1d');
    expect(report.payload).toEqual({ summary: { paymentsReviewed: 4 } });
  });

  it('regenerates compliance downloads from the stored report metadata', async () => {
    const getComplianceReportById = vi.fn().mockResolvedValue({
      id: '4e9c0600-4598-404f-932a-58e06b832d1d',
      reportType: 'sox_404',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-14',
      status: 'generated',
      artifactUri: null,
      downloadUrl: '',
      createdAt: '2026-03-14T10:00:00.000Z',
      updatedAt: '2026-03-14T10:00:00.000Z'
    });
    const generateCompliancePayload = vi.fn().mockResolvedValue({ summary: { paymentsReviewed: 8 } });
    const repository = {
      getComplianceReportById,
      generateCompliancePayload
    } as unknown as ReportsRepository;

    const service = new ReportsService(
      { organizationId: 'org-1', userId: 'user-1', requestId: 'req-1' },
      repository
    );

    const result = await service.getComplianceReportDownload('4e9c0600-4598-404f-932a-58e06b832d1d');

    expect(result.record.downloadUrl).toBe('/api/v1/reports/compliance?downloadId=4e9c0600-4598-404f-932a-58e06b832d1d');
    expect(result.payload).toEqual({ summary: { paymentsReviewed: 8 } });
  });
});
