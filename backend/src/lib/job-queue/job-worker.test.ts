import { describe, expect, it, vi } from 'vitest';
import { JobWorker } from '@/lib/job-queue/job-worker';
import type { Job } from '@/lib/job-queue/job-queue';

class TestWorker extends JobWorker<{ organizationId: string }> {
  readonly type = 'test.worker';
  readonly maxAttempts = 3;

  constructor(
    private readonly implementation: (payload: { organizationId: string }, job: Job<{ organizationId: string }>) => Promise<void>,
    queue: {
      complete: (jobId: string) => Promise<void>;
      fail: (jobId: string, error: Error, retryable: boolean) => Promise<void>;
    }
  ) {
    super(queue as never);
  }

  async handle(payload: { organizationId: string }, job: Job<{ organizationId: string }>): Promise<void> {
    await this.implementation(payload, job);
  }
}

const baseJob: Job<{ organizationId: string }> = {
  id: 'job-1',
  type: 'test.worker',
  payload: {
    organizationId: 'org-1'
  },
  status: 'running',
  attempts: 1,
  maxAttempts: 3,
  lastError: null,
  scheduledFor: '2026-03-14T12:00:00.000Z',
  startedAt: '2026-03-14T12:00:00.000Z',
  completedAt: null,
  organizationId: 'org-1',
  createdAt: '2026-03-14T11:59:00.000Z'
};

describe('JobWorker', () => {
  it('completes the queue item after a successful handle()', async () => {
    const queue = {
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined)
    };
    const worker = new TestWorker(async () => undefined, queue);

    await worker.execute(baseJob);

    expect(queue.complete).toHaveBeenCalledWith('job-1');
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it('marks jobs retryable while attempts remain', async () => {
    const queue = {
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined)
    };
    const worker = new TestWorker(async () => {
      throw new Error('retry me');
    }, queue);

    await expect(worker.execute(baseJob)).rejects.toThrow('retry me');
    expect(queue.fail).toHaveBeenCalledWith('job-1', expect.any(Error), true);
  });

  it('sends exhausted jobs to the dead-letter path', async () => {
    const queue = {
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined)
    };
    const worker = new TestWorker(async () => {
      throw new Error('stop retrying');
    }, queue);

    await expect(
      worker.execute({
        ...baseJob,
        attempts: 3
      })
    ).rejects.toThrow('stop retrying');

    expect(queue.fail).toHaveBeenCalledWith('job-1', expect.any(Error), false);
  });
});
