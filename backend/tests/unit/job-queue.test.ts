import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@/errors/ValidationError';
import { JobQueue, getRetryDelayMs } from '@/lib/job-queue/job-queue';
import { JobWorker } from '@/lib/job-queue/job-worker';
import type { Job } from '@/types/jobs/types';
import { createSupabaseClientMock } from '../utils/supabaseMock';

describe('JobQueue', () => {
  it('enqueues job rows with typed payload and scheduling metadata', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      job_queue: {
        data: { id: 'job-1' }
      }
    });
    const queue = new JobQueue(client as never);

    await expect(
      queue.enqueue(
        'bank.sync',
        { connectionId: 'conn-1', organizationId: 'org-1' },
        {
          organizationId: 'org-1',
          maxAttempts: 4,
          scheduledFor: '2026-03-14T10:00:00.000Z'
        }
      )
    ).resolves.toBe('job-1');

    const builder = getLastBuilder('job_queue');
    expect(builder.state.insertPayload).toEqual({
      type: 'bank.sync',
      payload: { connectionId: 'conn-1', organizationId: 'org-1' },
      organization_id: 'org-1',
      scheduled_for: '2026-03-14T10:00:00.000Z',
      max_attempts: 4
    });
  });

  it('dequeues via the RPC wrapper and maps job fields', async () => {
    const { client, getLastRpcCall } = createSupabaseClientMock({
      'rpc:dequeue_job_queue': {
        data: [
          {
            id: 'job-1',
            type: 'bank.sync',
            payload: { connectionId: 'conn-1', organizationId: 'org-1' },
            status: 'running',
            attempts: 1,
            max_attempts: 4,
            last_error: null,
            scheduled_for: '2026-03-14T10:00:00.000Z',
            started_at: '2026-03-14T10:00:05.000Z',
            completed_at: null,
            organization_id: 'org-1',
            created_at: '2026-03-14T09:59:59.000Z'
          }
        ]
      }
    });
    const queue = new JobQueue(client as never);

    await expect(queue.dequeue(['bank.sync'])).resolves.toEqual({
      id: 'job-1',
      type: 'bank.sync',
      payload: { connectionId: 'conn-1', organizationId: 'org-1' },
      status: 'running',
      attempts: 1,
      maxAttempts: 4,
      lastError: null,
      scheduledFor: '2026-03-14T10:00:00.000Z',
      startedAt: '2026-03-14T10:00:05.000Z',
      completedAt: null,
      organizationId: 'org-1',
      createdAt: '2026-03-14T09:59:59.000Z'
    });

    expect(getLastRpcCall('dequeue_job_queue')).toEqual({
      args: {
        p_worker_types: ['bank.sync']
      }
    });
  });

  it('marks retryable failures as retrying with backoff scheduling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T10:00:00.000Z'));

    const { client, getBuilders } = createSupabaseClientMock({
      job_queue: {
        data: {
          id: 'job-1',
          type: 'bank.sync',
          payload: {},
          status: 'running',
          attempts: 1,
          max_attempts: 4,
          last_error: null,
          scheduled_for: '2026-03-14T10:00:00.000Z',
          started_at: '2026-03-14T09:59:00.000Z',
          completed_at: null,
          organization_id: 'org-1',
          created_at: '2026-03-14T09:58:00.000Z'
        }
      }
    });
    const queue = new JobQueue(client as never);

    await queue.fail('job-1', new Error('temporary outage'), true);

    const builders = getBuilders('job_queue');
    expect(builders).toHaveLength(2);
    expect(builders[1]?.state.updatePayload).toEqual({
      status: 'retrying',
      last_error: expect.stringContaining('temporary outage'),
      scheduled_for: '2026-03-14T10:00:30.000Z',
      started_at: null,
      completed_at: null
    });

    vi.useRealTimers();
  });

  it('uses the documented retry schedule', () => {
    expect(getRetryDelayMs(1)).toBe(30_000);
    expect(getRetryDelayMs(2)).toBe(120_000);
    expect(getRetryDelayMs(3)).toBe(600_000);
    expect(getRetryDelayMs(4)).toBe(3_600_000);
    expect(getRetryDelayMs(9)).toBe(3_600_000);
  });
});

describe('JobWorker', () => {
  class RetryableWorker extends JobWorker<{ ok: boolean }> {
    readonly type = 'test.worker';
    readonly maxAttempts = 3;
    readonly handle = vi.fn(async () => {
      throw new Error('retry me');
    });
  }

  class ValidationWorker extends JobWorker<{ ok: boolean }> {
    readonly type = 'test.validation';
    readonly maxAttempts = 3;
    readonly handle = vi.fn(async () => {
      throw new ValidationError('bad payload');
    });
  }

  it('schedules retries for retryable worker failures', async () => {
    const queue = {
      complete: vi.fn(),
      fail: vi.fn(async () => undefined)
    };
    const worker = new RetryableWorker(queue as never);
    const job: Job<{ ok: boolean }> = {
      id: 'job-1',
      type: 'test.worker',
      payload: { ok: false },
      status: 'running',
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      scheduledFor: '2026-03-14T10:00:00.000Z',
      startedAt: null,
      completedAt: null,
      organizationId: 'org-1',
      createdAt: '2026-03-14T09:59:00.000Z'
    };

    await expect(worker.process(job)).rejects.toThrow('retry me');
    expect(queue.complete).not.toHaveBeenCalled();
    expect(queue.fail).toHaveBeenCalledWith('job-1', expect.any(Error), true);
  });

  it('marks validation failures as terminal', async () => {
    const queue = {
      complete: vi.fn(),
      fail: vi.fn(async () => undefined)
    };
    const worker = new ValidationWorker(queue as never);
    const job: Job<{ ok: boolean }> = {
      id: 'job-2',
      type: 'test.validation',
      payload: { ok: false },
      status: 'running',
      attempts: 1,
      maxAttempts: 3,
      lastError: null,
      scheduledFor: '2026-03-14T10:00:00.000Z',
      startedAt: null,
      completedAt: null,
      organizationId: 'org-1',
      createdAt: '2026-03-14T09:59:00.000Z'
    };

    await expect(worker.process(job)).rejects.toThrow('bad payload');
    expect(queue.fail).toHaveBeenCalledWith('job-2', expect.any(ValidationError), false);
  });
});
