import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { ok } from '@/lib/http';
import { AuthService } from '@/services/auth/service';

const MeResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email()
  }),
  memberships: z.array(
    z.object({
      organizationId: z.string().uuid(),
      roleId: z.string().uuid(),
      status: z.string()
    })
  ),
  permissions: z.record(z.array(z.string()))
});

export async function GET(request: NextRequest) {
  return executeRoute(
    request,
    {
      requiresOrganization: false
    },
    async (_req, context) => {
      const authService = new AuthService();
      const response = await authService.getProfile({
        id: context.user!.id,
        email: context.user!.email
      });
      return ok(
        parseResponse(response, MeResponseSchema),
        context.requestId
      );
    }
  );
}

export const OPTIONS = buildOptionsHandler();
