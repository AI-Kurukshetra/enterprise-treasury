import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { UpdateRiskAlertRequestSchema } from '@/schemas/risk/schema';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const RiskAlertSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  risk_type: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string(),
  message: z.string(),
  related_entity_type: z.string().nullable(),
  related_entity_id: z.string().uuid().nullable(),
  status: z.enum(['open', 'acknowledged', 'resolved']),
  resolved_at: z.string().nullable(),
  resolved_by: z.string().uuid().nullable(),
  resolution_note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

interface RouteParams {
  params: Promise<{ alertId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, { requiredPermission: 'risk.calculate' }, async (_req, context) => {
    const { alertId } = await params;
    const body = await parseJsonBody(request, UpdateRiskAlertRequestSchema);
    const services = buildServices(toServiceContext(context));
    const alert =
      body.action === 'acknowledge'
        ? await services.risk.acknowledgeAlert(alertId, body.note)
        : await services.risk.resolveAlert(alertId, body.note);

    return ok(parseResponse(alert, RiskAlertSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
