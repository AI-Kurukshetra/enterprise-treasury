import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { NotificationCountSchema } from '@/schemas/notifications/schema';
import { buildServices } from '@/services/serviceFactory';

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.notifications.getUnreadCount();
    return ok(parseResponse(result, NotificationCountSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
