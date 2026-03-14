import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { PAYMENT_STATUSES } from '@/constants/financial';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const PaymentSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(PAYMENT_STATUSES),
  version: z.number().int().positive()
}).passthrough();

interface RouteParams {
  params: Promise<{ paymentId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return executeRoute(
    request,
    { requiredPermission: 'payments.retry', useIdempotency: true, rateLimit: 'api.sensitive' },
    async (_req, context) => {
    const { paymentId } = await params;
    const services = buildServices(toServiceContext(context));
    const payment = await services.payments.retry(paymentId, context.idempotencyKey!);
    return ok(parseResponse(payment, PaymentSchema), context.requestId);
    }
  );
}

export const OPTIONS = buildOptionsHandler();
