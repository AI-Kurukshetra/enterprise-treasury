import { z } from 'zod';

export const ApprovalDecisionBodySchema = z.object({
  rowVersionToken: z.string().regex(/^\d+$/),
  comment: z.string().max(280).optional()
});

export const RejectDecisionBodySchema = z.object({
  rowVersionToken: z.string().regex(/^\d+$/),
  reason: z.string().min(1).max(280)
});
