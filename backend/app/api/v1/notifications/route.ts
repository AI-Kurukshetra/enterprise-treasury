import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { ListNotificationsQuerySchema, NotificationListResponseSchema } from '@/schemas/notifications/schema';
import { buildServices } from '@/services/serviceFactory';

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, ListNotificationsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.notifications.list({
      isRead: query.isRead,
      limit: query.limit,
      cursor: query.cursor
    });

    return ok(parseResponse(result, NotificationListResponseSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
