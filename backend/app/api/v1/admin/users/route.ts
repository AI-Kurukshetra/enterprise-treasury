import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { AdminService } from '@/services/admin/service';

const AdminUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string().email(),
  role: z.string(),
  status: z.enum(['active', 'invited', 'revoked']),
  lastLogin: z.string().nullable(),
  mfaEnabled: z.boolean()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'admin.users.read' }, async (_req, context) => {
    const adminService = new AdminService(toServiceContext(context));
    return ok(parseResponse(await adminService.listUsers(), z.array(AdminUserSchema)), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
