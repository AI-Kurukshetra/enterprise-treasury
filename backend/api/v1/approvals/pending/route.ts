import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const PendingApprovalSchema = z.object({
  paymentId: z.string().uuid(),
  paymentReference: z.string(),
  amount: z.string(),
  currencyCode: z.string().length(3),
  valueDate: z.string(),
  createdAt: z.string(),
  rowVersionToken: z.string().regex(/^\d+$/)
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const list = await services.approvals.listPending(context.user!.id);
    return ok(parseResponse(list, z.array(PendingApprovalSchema)), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
