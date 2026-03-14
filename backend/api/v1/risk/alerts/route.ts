import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { ListRiskAlertsQuerySchema } from '@/schemas/risk/schema';
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

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, ListRiskAlertsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const alerts = await services.risk.listAlerts({
      status: query.status,
      severity: query.severity,
      riskType: query.riskType
    });

    return ok(parseResponse(alerts, z.array(RiskAlertSchema)), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
