import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { AdminService } from '@/services/admin/service';

const CreateRoleRequestSchema = z.object({
  name: z.string().min(1).max(80),
  permissions: z.array(z.string().min(1)).min(1)
});

const CreateRoleResponseSchema = z.object({
  roleId: z.string().uuid(),
  name: z.string()
});

const AdminRoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isSystem: z.boolean(),
  permissionCount: z.number().int().nonnegative(),
  permissions: z.array(z.string())
});

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'admin.roles.read' }, async (_req, context) => {
    const adminService = new AdminService(toServiceContext(context));
    return ok(parseResponse(await adminService.listRoles(), z.array(AdminRoleSchema)), context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'admin.roles.manage' }, async (_req, context) => {
    const body = await parseJsonBody(request, CreateRoleRequestSchema);
    const adminService = new AdminService(toServiceContext(context));
    return ok(
      parseResponse(await adminService.createRole(body.name, body.permissions), CreateRoleResponseSchema),
      context.requestId,
      201
    );
  });
}

export const OPTIONS = buildOptionsHandler();
