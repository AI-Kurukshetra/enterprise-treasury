import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { NotFoundError } from '@/errors/NotFoundError';
import { JobQueue } from '@/lib/job-queue/job-queue';
import { ok } from '@/lib/http';

const JobSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  payload: z.unknown(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'retrying']),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastError: z.string().nullable(),
  scheduledFor: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  organizationId: z.string().uuid(),
  createdAt: z.string()
});

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, { requiredPermission: 'admin.roles.manage' }, async (_req, context) => {
    const { jobId } = await params;
    const queue = new JobQueue();
    const job = await queue.getStatus(jobId);

    if (job.organizationId !== context.organizationId) {
      throw new NotFoundError('Job not found');
    }

    return ok(JobSchema.parse(job), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
