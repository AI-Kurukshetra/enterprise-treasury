import type { UUID } from '@/types/common';
import type { Job as QueueJob, JobStatus as QueueJobStatus } from '@/lib/job-queue/job-queue';

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'retrying'] as const;

export type JobStatus = QueueJobStatus;

export type Job<T = unknown> = QueueJob<T>;

export interface JobFilters {
  status?: JobStatus;
  type?: string;
  limit?: number;
}

export interface JobEnqueueOptions {
  organizationId?: UUID;
  scheduledFor?: string;
  maxAttempts?: number;
}
