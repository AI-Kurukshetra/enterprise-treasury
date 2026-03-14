import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { NotificationReadSchema } from '@/schemas/notifications/schema';
import { buildServices } from '@/services/serviceFactory';

interface RouteParams {
  params: Promise<{ notificationId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, {}, async (_req, context) => {
    const { notificationId } = await params;
    const services = buildServices(toServiceContext(context));
    const result = await services.notifications.markUnread(notificationId);
    return ok(parseResponse(result, NotificationReadSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
