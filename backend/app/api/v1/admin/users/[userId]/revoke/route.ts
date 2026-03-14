import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { AdminService } from '@/services/admin/service';

const RevokeUserResponseSchema = z.object({
  userId: z.string().uuid(),
  status: z.literal('revoked')
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  return executeRoute(request, { requiredPermission: 'admin.users.manage' }, async (_req, context) => {
    const { userId } = await params;
    const adminService = new AdminService(toServiceContext(context));
    return ok(parseResponse(await adminService.revokeUser(userId), RevokeUserResponseSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
