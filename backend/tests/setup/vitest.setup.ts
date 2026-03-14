import { beforeEach } from 'vitest';
import { clearErrorTrackingHooks } from '@/lib/errorTracking';
import { resetMetrics } from '@/lib/metrics';
import { clearRateLimitStore } from '@/middleware/rateLimitMiddleware';
import { resetEnvCache } from '@/config/env';

Object.assign(process.env, { NODE_ENV: 'test' });
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'anon-test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-test-key';
process.env.ANTHROPIC_API_KEY ??= 'anthropic-test-key';

beforeEach(() => {
  clearErrorTrackingHooks();
  resetMetrics();
  clearRateLimitStore();
  resetEnvCache();
});
