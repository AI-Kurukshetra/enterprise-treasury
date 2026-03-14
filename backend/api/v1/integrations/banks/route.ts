import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { CreateBankIntegrationRequestSchema } from '@/schemas/integrations/schema';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const BankIntegrationSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  provider: z.string(),
  connection_type: z.enum(['open_banking', 'sftp', 'manual_file']),
  status: z.enum(['active', 'degraded', 'disconnected']),
  last_sync_at: z.string().nullable()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.integrations.listBanks();
    return ok(parseResponse(result, z.array(BankIntegrationSchema)), context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'integrations.manage' }, async (_req, context) => {
    const body = await parseJsonBody(request, CreateBankIntegrationRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.integrations.createBank(body);
    return ok(parseResponse(result, BankIntegrationSchema), context.requestId, 201);
  });
}

export const OPTIONS = buildOptionsHandler();
