import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { GenerateComplianceReportRequestSchema, ComplianceReportListQuerySchema } from '@/schemas/reports/schema';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const ComplianceReportResponseSchema = z.object({
  reportId: z.string().uuid(),
  jobId: z.string().uuid(),
  reportType: z.enum(['sox_404', 'regulatory', 'audit']),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.literal('queued'),
  downloadUrl: z.string()
});

const ComplianceReportRecordSchema = z.object({
  id: z.string().uuid(),
  reportType: z.enum(['sox_404', 'regulatory', 'audit']),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.enum(['draft', 'generated', 'approved', 'filed']),
  artifactUri: z.string().nullable(),
  downloadUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'reports.generate' }, async (_req, context) => {
    const body = await parseJsonBody(request, GenerateComplianceReportRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = parseResponse(
      await services.reports.generateComplianceReport(
        context.organizationId!,
        body.periodStart,
        body.periodEnd,
        body.reportType,
        body.format
      ),
      ComplianceReportResponseSchema
    );

    return ok(result, context.requestId, 202);
  });
}

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'reports.read' }, async (_req, context) => {
    const query = parseQuery(request, ComplianceReportListQuerySchema);
    const services = buildServices(toServiceContext(context));

    if (query.downloadId) {
      const report = await services.reports.getComplianceReportDownload(query.downloadId);
      await services.reports.logReportDownload({
        action: 'report.compliance.download',
        entityType: 'compliance_report',
        entityId: query.downloadId,
        metadata: {
          reportType: report.record.reportType,
          periodStart: report.record.periodStart,
          periodEnd: report.record.periodEnd
        }
      });

      return new NextResponse(JSON.stringify({ data: report.payload }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="compliance-${report.record.reportType}-${report.record.periodStart}-${report.record.periodEnd}.json"`
        }
      });
    }

    const reports = parseResponse(await services.reports.listComplianceReports(), z.array(ComplianceReportRecordSchema));
    return ok(reports, context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
