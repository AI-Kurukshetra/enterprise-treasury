import { AppError } from '@/errors/AppError';
import { logger } from '@/lib/logger';
import { JobQueue, getRetryDelayMs, type Job } from '@/lib/job-queue/job-queue';

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === 'string' ? error : 'Unknown job worker error');
}

export abstract class JobWorker<TPayload = unknown> {
  protected readonly queue: JobQueue;

  abstract readonly type: string;
  abstract readonly maxAttempts: number;

  constructor(queue?: JobQueue) {
    this.queue = queue ?? new JobQueue();
  }

  abstract handle(payload: TPayload, job: Job<TPayload>): Promise<void>;

  protected isRetryable(error: Error, _job: Job<TPayload>): boolean {
    if (error instanceof AppError) {
      return error.statusCode >= 500;
    }

    return true;
  }

  async process(job: Job<TPayload>): Promise<void> {
    const startedAt = Date.now();

    logger.log({
      level: 'info',
      message: 'Job execution started',
      domain: 'job_worker',
      eventType: 'job.start',
      organizationId: job.organizationId,
      data: {
        jobId: job.id,
        type: job.type,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts
      }
    });

    try {
      await this.handle(job.payload, job);
      await this.queue.complete(job.id);

      logger.log({
        level: 'info',
        message: 'Job execution completed',
        domain: 'job_worker',
        eventType: 'job.success',
        organizationId: job.organizationId,
        data: {
          jobId: job.id,
          type: job.type,
          durationMs: Date.now() - startedAt,
          attempts: job.attempts
        }
      });
    } catch (caughtError) {
      const error = toError(caughtError);
      const retryable = this.isRetryable(error, job) && job.attempts < job.maxAttempts;

      await this.queue.fail(job.id, error, retryable);

      logger.log({
        level: 'error',
        message: 'Job execution failed',
        domain: 'job_worker',
        eventType: 'job.failure',
        organizationId: job.organizationId,
        data: {
          jobId: job.id,
          type: job.type,
          durationMs: Date.now() - startedAt,
          attempts: job.attempts,
          retryable,
          nextRetryInMs: retryable ? getRetryDelayMs(job.attempts) : null,
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack
        }
      });

      throw error;
    }
  }

  async execute(job: Job<TPayload>): Promise<void> {
    await this.process(job);
  }
}
