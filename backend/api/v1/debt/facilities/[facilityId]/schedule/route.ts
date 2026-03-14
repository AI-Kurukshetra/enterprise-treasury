import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const ScheduleLineSchema = z.object({
  id: z.string().uuid(),
  debt_facility_id: z.string().uuid(),
  due_date: z.string(),
  principal_due: z.string(),
  interest_due: z.string(),
  status: z.enum(['scheduled', 'paid', 'overdue'])
});

interface RouteParams {
  params: Promise<{ facilityId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, {}, async (_req, context) => {
    const { facilityId } = await params;
    const services = buildServices(toServiceContext(context));
    const result = await services.debt.getSchedule(facilityId);
    return ok(parseResponse(result, z.array(ScheduleLineSchema)), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
