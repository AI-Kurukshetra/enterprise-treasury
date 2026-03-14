import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { ok } from '@/lib/http';
import { AuthService } from '@/services/auth/service';

const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const LoginResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email()
  }),
  session: z.object({
    accessToken: z.string(),
    expiresIn: z.number().int().positive()
  })
});

export async function POST(request: NextRequest) {
  return executeRoute(
    request,
    {
      requiresAuth: false,
      requiresOrganization: false,
      rateLimit: 'auth.login'
    },
    async (_req, context) => {
      const body = await parseJsonBody(request, LoginRequestSchema);
      const authService = new AuthService();
      const response = parseResponse(await authService.login(body.email, body.password), LoginResponseSchema);

      return ok(response, context.requestId);
    }
  );
}

export const OPTIONS = buildOptionsHandler();
