import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { ok } from '@/lib/http';
import { AuthService } from '@/services/auth/service';

const LogoutResponseSchema = z.object({ success: z.literal(true) });

export async function POST(request: NextRequest) {
  return executeRoute(
    request,
    {
      requiresOrganization: false
    },
    async (_req, context) => {
      const authService = new AuthService();
      return ok(parseResponse(authService.logout(), LogoutResponseSchema), context.requestId);
    }
  );
}

export const OPTIONS = buildOptionsHandler();
