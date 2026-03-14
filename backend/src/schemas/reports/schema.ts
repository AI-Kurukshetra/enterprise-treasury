import { z } from 'zod';

export const ComplianceReportTypeSchema = z.enum(['sox_404', 'regulatory', 'audit']);

export const GenerateComplianceReportRequestSchema = z.object({
  reportType: ComplianceReportTypeSchema,
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  format: z.enum(['json', 'csv']).optional().default('json')
});

export const CashSummaryQuerySchema = z.object({
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  format: z.enum(['json', 'csv']).optional().default('json')
});

export const LiquidityReportQuerySchema = z.object({
  asOf: z.string().date(),
  format: z.enum(['json', 'csv']).optional().default('json')
});

export const ComplianceReportListQuerySchema = z.object({
  downloadId: z.string().uuid().optional()
});
