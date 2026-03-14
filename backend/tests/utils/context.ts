import type { ServiceContext } from '@/services/context';

export function createServiceContext(overrides: Partial<ServiceContext> = {}): ServiceContext {
  return {
    organizationId: overrides.organizationId ?? 'org-test-1',
    userId: overrides.userId ?? 'user-test-1',
    requestId: overrides.requestId ?? 'req-test-1'
  };
}
