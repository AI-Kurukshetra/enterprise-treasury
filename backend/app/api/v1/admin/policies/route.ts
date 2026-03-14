import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { PolicyDomainSchema, PolicyRuleSchema } from '@/lib/policy-engine/policy-types';
import { PolicyAdminService } from '@/services/admin/policy-service';

const ListPoliciesQuerySchema = z.object({
  domain: PolicyDomainSchema.optional()
});

const CreatePolicyRequestSchema = z.object({
  name: z.string().min(1).max(120),
  domain: PolicyDomainSchema,
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

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'policy.read' }, async (_req, context) => {
    const query = parseQuery(request, ListPoliciesQuerySchema);
    const service = new PolicyAdminService(toServiceContext(context));
    return ok(parseResponse(await service.listPolicies(query.domain), z.array(AdminPolicySchema)), context.requestId);
  });
}

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'policy.manage' }, async (_req, context) => {
    const body = await parseJsonBody(request, CreatePolicyRequestSchema);
    const service = new PolicyAdminService(toServiceContext(context));
    return ok(parseResponse(await service.createPolicy(body), AdminPolicySchema), context.requestId, 201);
  });
}

export const OPTIONS = buildOptionsHandler();
