import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { ApprovalDecisionBodySchema } from '@/schemas/approvals/schema';
import { toServiceContext } from '@/api/serviceContext';
import { PAYMENT_STATUSES } from '@/constants/financial';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const ApprovalResultSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(PAYMENT_STATUSES),
  version: z.number().int().positive()
}).passthrough();

interface RouteParams {
  params: Promise<{ paymentId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, { requiredPermission: 'payments.approve', rateLimit: 'api.sensitive' }, async (_req, context) => {
    const { paymentId } = await params;
    const body = await parseJsonBody(request, ApprovalDecisionBodySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.approvals.approve(
      {
        paymentId,
        rowVersionToken: body.rowVersionToken,
        comment: body.comment
      },
      context.user!.id
    );

    return ok(parseResponse(result, ApprovalResultSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
