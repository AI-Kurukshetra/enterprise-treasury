import { AsyncLocalStorage } from 'node:async_hooks';

export interface ActiveRequestContext {
  requestId: string;
  traceId: string;
  path: string;
  method: string;
  organizationId?: string;
  actorId?: string;
  rateLimitKey?: string;
}

const storage = new AsyncLocalStorage<ActiveRequestContext>();

export function runWithRequestContext<T>(context: ActiveRequestContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function getActiveRequestContext(): ActiveRequestContext | undefined {
  return storage.getStore();
}

export function updateActiveRequestContext(patch: Partial<ActiveRequestContext>): void {
  const active = storage.getStore();
  if (!active) {
    return;
  }

  Object.assign(active, patch);
}
