import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const SyncJobSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  integration_type: z.string(),
  direction: z.enum(['import', 'export']),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'partial']),
  created_at: z.string()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.integrations.listSyncJobs();
    return ok(parseResponse(result, z.array(SyncJobSchema)), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
