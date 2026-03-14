import type { HttpMethod, UUID } from '@/types/common';

export interface AuthenticatedUser {
  id: UUID;
  email: string;
}

export interface RequestContext {
  requestId: string;
  traceId: string;
  method: HttpMethod;
  path: string;
  user?: AuthenticatedUser;
  organizationId?: UUID;
  requiredPermission?: string;
  idempotencyKey?: string;
  rateLimitKey?: string;
}
