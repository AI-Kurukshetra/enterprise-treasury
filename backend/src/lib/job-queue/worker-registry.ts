import type { JobWorker } from '@/lib/job-queue/job-worker';

export class WorkerRegistry {
  private readonly workers = new Map<string, JobWorker<any>>();

  registerWorker(worker: JobWorker<any>): void {
    this.workers.set(worker.type, worker);
  }

  getWorker(type: string): JobWorker<any> | null {
    return this.workers.get(type) ?? null;
  }

  getAllTypes(): string[] {
    return Array.from(this.workers.keys());
  }
}

export const defaultWorkerRegistry = new WorkerRegistry();

export function registerWorker(worker: JobWorker<any>): void {
  defaultWorkerRegistry.registerWorker(worker);
}

export function getWorker(type: string): JobWorker<any> | null {
  return defaultWorkerRegistry.getWorker(type);
}

export function getAllTypes(): string[] {
  return defaultWorkerRegistry.getAllTypes();
}
