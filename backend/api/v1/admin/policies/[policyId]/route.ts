import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { PolicyDomainSchema, PolicyRuleSchema } from '@/lib/policy-engine/policy-types';
import { PolicyAdminService } from '@/services/admin/policy-service';

const ParamsSchema = z.object({
  policyId: z.string().uuid()
});

const UpdatePolicyRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  domain: PolicyDomainSchema.optional(),
  rules: z.array(PolicyRuleSchema).min(1),
  isActive: z.boolean().optional(),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().nullable().optional()
});

const AdminPolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  domain: PolicyDomainSchema,
  version: z.number().int().positive(),
  rules: z.array(PolicyRuleSchema),
  isActive: z.boolean(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> }
) {
  return executeRoute(request, { requiredPermission: 'policy.read' }, async (_req, context) => {
    const routeParams = ParamsSchema.parse(await params);
    const service = new PolicyAdminService(toServiceContext(context));
    return ok(parseResponse(await service.getPolicy(routeParams.policyId), AdminPolicySchema), context.requestId);
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> }
) {
  return executeRoute(request, { requiredPermission: 'policy.manage' }, async (_req, context) => {
    const routeParams = ParamsSchema.parse(await params);
    const body = await parseJsonBody(request, UpdatePolicyRequestSchema);
    const service = new PolicyAdminService(toServiceContext(context));
    return ok(parseResponse(await service.updatePolicy(routeParams.policyId, body), AdminPolicySchema), context.requestId);
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ policyId: string }> }
) {
  return executeRoute(request, { requiredPermission: 'policy.manage' }, async (_req, context) => {
    const routeParams = ParamsSchema.parse(await params);
    const service = new PolicyAdminService(toServiceContext(context));
    return ok(parseResponse(await service.deactivatePolicy(routeParams.policyId), AdminPolicySchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
