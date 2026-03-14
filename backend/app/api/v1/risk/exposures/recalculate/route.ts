import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { RecalculateRiskExposureRequestSchema } from '@/schemas/risk/schema';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const RecalculateResponseSchema = z.object({ jobId: z.string().uuid() });

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'risk.calculate' }, async (_req, context) => {
    const rawBody = await request.text();
    const parsedBody = rawBody.trim().length > 0 ? JSON.parse(rawBody) : {};
    const body = RecalculateRiskExposureRequestSchema.parse(parsedBody);
    const services = buildServices(toServiceContext(context));
    const result = await services.risk.recalculate(body.referenceDate);
    return ok(parseResponse(result, RecalculateResponseSchema), context.requestId, 202);
  });
}

export const OPTIONS = buildOptionsHandler();
