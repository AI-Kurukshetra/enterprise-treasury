export interface ErrorTrackingPayload {
  error: unknown;
  requestId: string;
  traceId: string;
  path: string;
  method: string;
  organizationId?: string;
  actorId?: string;
}

type ErrorTrackingHook = (payload: ErrorTrackingPayload) => void | Promise<void>;

const hooks: ErrorTrackingHook[] = [];

export function registerErrorTrackingHook(hook: ErrorTrackingHook): void {
  hooks.push(hook);
}

export async function captureError(payload: ErrorTrackingPayload): Promise<void> {
  await Promise.allSettled(hooks.map(async (hook) => hook(payload)));
}

export function clearErrorTrackingHooks(): void {
  hooks.length = 0;
}
