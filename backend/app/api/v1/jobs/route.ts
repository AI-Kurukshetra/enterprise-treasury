import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { JobQueue } from '@/lib/job-queue/job-queue';
import { ok } from '@/lib/http';

const JobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'retrying']);

const JobSchema = z.object({
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
  organizationId: z.string().uuid(),
  createdAt: z.string()
});

const JobsQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  type: z.string().optional()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'admin.roles.manage' }, async (_req, context) => {
    const query = parseQuery(request, JobsQuerySchema);
    const queue = new JobQueue();
    const jobs = await queue.listJobs(context.organizationId!, query);

    return ok(parseResponse(jobs, z.array(JobSchema)), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
