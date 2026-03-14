import type { SupabaseClient } from '@supabase/supabase-js';
import { NotFoundError } from '@/errors/NotFoundError';
import { ValidationError } from '@/errors/ValidationError';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { assertNoQueryError } from '@/repositories/base/execute';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'retrying';

export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  scheduledFor: string;
  startedAt: string | null;
  completedAt: string | null;
  organizationId: string;
  createdAt: string;
}

export interface EnqueueJobOptions {
  organizationId?: string;
  scheduledFor?: string;
  maxAttempts?: number;
}

export interface ListJobsFilters {
  status?: JobStatus;
  type?: string;
  limit?: number;
}

interface JobRow<T = unknown> {
  id: string;
  type: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_for: string;
  started_at: string | null;
  completed_at: string | null;
  organization_id: string;
  created_at: string;
}

const RETRY_BACKOFF_SCHEDULE_MS = [30_000, 120_000, 600_000, 3_600_000] as const;

function toJob<T>(row: JobRow<T>): Job<T> {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    organizationId: row.organization_id,
    createdAt: row.created_at
  };
}

function extractOrganizationId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const organizationId = (payload as { organizationId?: unknown }).organizationId;
  return typeof organizationId === 'string' && organizationId.length > 0 ? organizationId : null;
}

function normalizeRpcJob<T>(payload: unknown): Job<T> | null {
  if (!payload) {
    return null;
  }

  if (Array.isArray(payload)) {
    const first = payload[0] as JobRow<T> | undefined;
    return first ? toJob(first) : null;
  }

  return toJob(payload as JobRow<T>);
}

export function getRetryDelayMs(attemptNumber: number): number {
  const normalizedAttempt = Math.max(1, attemptNumber);
  return (
    RETRY_BACKOFF_SCHEDULE_MS[Math.min(normalizedAttempt, RETRY_BACKOFF_SCHEDULE_MS.length) - 1] ??
    RETRY_BACKOFF_SCHEDULE_MS[0]
  );
}

export function formatJobError(error: Error): string {
  return error.stack ?? `${error.name}: ${error.message}`;
}

export class JobQueue {
  private readonly db: SupabaseClient;

  constructor(dbClient?: SupabaseClient) {
    this.db = dbClient ?? createServiceSupabaseClient();
  }

  async enqueue<T>(type: string, payload: T, options?: EnqueueJobOptions): Promise<string> {
    const organizationId = options?.organizationId ?? extractOrganizationId(payload);

    if (!organizationId) {
      throw new ValidationError('organizationId is required to enqueue a job');
    }

    const { data, error } = await this.db
      .from('job_queue')
      .insert({
        organization_id: organizationId,
        type,
        payload,
        max_attempts: options?.maxAttempts ?? 3,
        scheduled_for: options?.scheduledFor ?? new Date().toISOString()
      })
      .select('id')
      .single();

    assertNoQueryError(error);

    return (data as { id: string }).id;
  }

  async dequeue<T>(workerTypes: string[]): Promise<Job<T> | null> {
    if (workerTypes.length === 0) {
      return null;
    }

    const { data, error } = await this.db.rpc('dequeue_job_queue', {
      p_worker_types: workerTypes
    });

    assertNoQueryError(error);
    return normalizeRpcJob<T>(data);
  }

  async complete(jobId: string): Promise<void> {
    const { error } = await this.db
      .from('job_queue')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        last_error: null
      })
      .eq('id', jobId);

    assertNoQueryError(error);
  }

  async fail(jobId: string, error: Error, retryable: boolean): Promise<void> {
    const job = await this.getStatus(jobId);
    const nextRetryAt = new Date(Date.now() + getRetryDelayMs(job.attempts)).toISOString();
    const shouldRetry = retryable && job.attempts < job.maxAttempts;

    const { error: updateError } = await this.db
      .from('job_queue')
      .update(
        shouldRetry
          ? {
              status: 'retrying',
              last_error: formatJobError(error),
              scheduled_for: nextRetryAt,
              started_at: null,
              completed_at: null
            }
          : {
              status: 'failed',
              last_error: formatJobError(error),
              completed_at: new Date().toISOString()
            }
      )
      .eq('id', jobId);

    assertNoQueryError(updateError);
  }

  async getStatus<T>(jobId: string): Promise<Job<T>> {
    const { data, error } = await this.db.from('job_queue').select('*').eq('id', jobId).maybeSingle();

    assertNoQueryError(error);

    if (!data) {
      throw new NotFoundError(`Job ${jobId} was not found`, { jobId });
    }

    return toJob(data as JobRow<T>);
  }

  async listJobs<T>(organizationId: string, filters: ListJobsFilters = {}): Promise<Job<T>[]> {
    let query = this.db.from('job_queue').select('*').eq('organization_id', organizationId);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.type) {
      query = query.eq('type', filters.type);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(filters.limit ?? 100);
    assertNoQueryError(error);

    return ((data ?? []) as JobRow<T>[]).map((row) => toJob(row));
  }
}
