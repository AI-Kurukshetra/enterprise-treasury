import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const SyncResponseSchema = z.object({ syncJobId: z.string().uuid() });

interface RouteParams {
  params: Promise<{ connectionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, { requiredPermission: 'integrations.sync' }, async (_req, context) => {
    const { connectionId } = await params;
    const services = buildServices(toServiceContext(context));
    const result = await services.integrations.triggerBankSync(connectionId);
    return ok(parseResponse(result, SyncResponseSchema), context.requestId, 202);
  });
}

export const OPTIONS = buildOptionsHandler();
