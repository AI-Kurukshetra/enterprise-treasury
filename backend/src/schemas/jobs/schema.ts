import { z } from 'zod';
import { JOB_STATUSES } from '@/types/jobs/types';

export const JobStatusSchema = z.enum(JOB_STATUSES);

export const JobSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  payload: z.unknown(),
  status: JobStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastError: z.string().nullable(),
  scheduledFor: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  organizationId: z.string().uuid().nullable(),
  createdAt: z.string()
});

export const ListJobsQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  type: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});
