import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ValidationError } from '@/errors/ValidationError';
import { ok } from '@/lib/http';
import { PolicyAdminService } from '@/services/admin/policy-service';

const ValidatePolicyRequestSchema = z.object({
  rules: z.unknown()
});

const ValidatePolicyResponseSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string())
});

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'policy.manage' }, async (_req, context) => {
    const body = await parseJsonBody(request, ValidatePolicyRequestSchema);
    const service = new PolicyAdminService(toServiceContext(context));

    try {
      service.validateRules(body.rules);
      return ok(parseResponse({ valid: true, errors: [] }, ValidatePolicyResponseSchema), context.requestId);
    } catch (error) {
      if (error instanceof ValidationError) {
        const rawIssues = error.details?.issues;
        const errors = Array.isArray(rawIssues)
          ? rawIssues.filter((issue): issue is string => typeof issue === 'string')
          : [error.message];
        return ok(parseResponse({ valid: false, errors }, ValidatePolicyResponseSchema), context.requestId);
      }

      throw error;
    }
  });
}

export const OPTIONS = buildOptionsHandler();
