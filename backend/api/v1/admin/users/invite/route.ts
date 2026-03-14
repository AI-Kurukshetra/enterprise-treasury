import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { ok } from '@/lib/http';

const InviteUserRequestSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1).max(80)
});

const InviteUserResponseSchema = z.object({
  status: z.literal('queued'),
  email: z.string().email(),
  role: z.string(),
  message: z.string()
});

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'admin.users.manage' }, async (_req, context) => {
    const body = await parseJsonBody(request, InviteUserRequestSchema);
    return ok(
      parseResponse(
        {
          status: 'queued',
          email: body.email,
          role: body.role,
          message: 'User invitation stub accepted for future implementation.'
        },
        InviteUserResponseSchema
      ),
      context.requestId,
      202
    );
  });
}

export const OPTIONS = buildOptionsHandler();
