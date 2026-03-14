import { incrementCounter, recordTiming } from '@/lib/metrics';
import { logger } from '@/lib/logger';
import { JobQueue } from '@/lib/job-queue/job-queue';
import { defaultWorkerRegistry, type WorkerRegistry } from '@/lib/job-queue/worker-registry';
import { registerDefaultWorkers } from '@/workers';

export class JobScheduler {
  private readonly queue: JobQueue;
  private readonly registry: WorkerRegistry;
  private readonly maxConcurrency: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly activeJobs = new Map<string, Promise<void>>();
  private isStopping = false;

  constructor(queue?: JobQueue, registry: WorkerRegistry = registerDefaultWorkers() ?? defaultWorkerRegistry, maxConcurrency = 3) {
    this.queue = queue ?? new JobQueue();
    this.registry = registry;
    this.maxConcurrency = Math.max(1, maxConcurrency);
  }

  poll(intervalMs: number): void {
    if (this.intervalHandle) {
      return;
    }

    this.intervalHandle = setInterval(() => {
      void this.fillAvailableSlots();
    }, intervalMs);

    void this.fillAvailableSlots();
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async processNext(): Promise<void> {
    const promise = await this.startNextJob();
    if (promise) {
      await promise;
    }
  }

  async gracefulShutdown(): Promise<void> {
    this.isStopping = true;
    this.stop();
    await Promise.allSettled(this.activeJobs.values());
  }

  private async fillAvailableSlots(): Promise<void> {
    if (this.isStopping) {
      return;
    }

    while (this.activeJobs.size < this.maxConcurrency) {
      const promise = await this.startNextJob();
      if (!promise) {
        return;
      }
    }
  }

  private async startNextJob(): Promise<Promise<void> | null> {
    if (this.isStopping || this.activeJobs.size >= this.maxConcurrency) {
      return null;
    }

    const workerTypes = this.registry.getAllTypes();
    if (workerTypes.length === 0) {
      return null;
    }

    const job = await this.queue.dequeue(workerTypes);
    if (!job) {
      return null;
    }

    const worker = this.registry.getWorker(job.type);
    if (!worker) {
      const error = new Error(`No registered worker for type ${job.type}`);
      await this.queue.fail(job.id, error, false);
      incrementCounter('job_scheduler.jobs.missing_worker');
      logger.log({
        level: 'error',
        message: 'Dequeued job without a registered worker',
        domain: 'job_scheduler',
        eventType: 'job.missing_worker',
        organizationId: job.organizationId,
        data: {
          jobId: job.id,
          type: job.type
        }
      });
      return null;
    }

    const startedAt = Date.now();
    const execution = (async () => {
      try {
        await worker.execute(job);
        incrementCounter('job_scheduler.jobs.completed');
      } catch (error) {
        incrementCounter('job_scheduler.jobs.failed');
        throw error;
      } finally {
        this.activeJobs.delete(job.id);
        recordTiming('job_scheduler.jobs.duration_ms', Date.now() - startedAt);
        logger.log({
          level: 'info',
          message: 'Scheduler finished processing job',
          domain: 'job_scheduler',
          eventType: 'job.processed',
          organizationId: job.organizationId,
          data: {
            jobId: job.id,
            type: job.type,
            activeJobs: this.activeJobs.size
          }
        });

        if (!this.isStopping) {
          void this.fillAvailableSlots();
        }
      }
    })();

    this.activeJobs.set(job.id, execution);
    incrementCounter('job_scheduler.jobs.started');
    logger.log({
      level: 'info',
      message: 'Scheduler started processing job',
      domain: 'job_scheduler',
      eventType: 'job.claimed',
      organizationId: job.organizationId,
      data: {
        jobId: job.id,
        type: job.type,
        activeJobs: this.activeJobs.size,
        maxConcurrency: this.maxConcurrency
      }
    });

    return execution;
  }
}

export { JobScheduler as Scheduler };
