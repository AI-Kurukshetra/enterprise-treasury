import { z } from 'zod';

export const ListRiskExposureQuerySchema = z.object({
  riskType: z.enum(['fx', 'interest_rate', 'credit', 'liquidity']).optional(),
  date: z.string().date().optional(),
  currency: z.string().length(3).optional()
});

export const ListRiskAlertsQuerySchema = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  riskType: z.string().min(1).optional()
});

export const RecalculateRiskExposureRequestSchema = z
  .object({
    referenceDate: z.string().date().optional()
  })
  .optional()
  .default({});

export const UpdateRiskAlertRequestSchema = z.object({
  action: z.enum(['acknowledge', 'resolve']),
  note: z.string().trim().min(1)
});
