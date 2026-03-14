import { ZodError } from 'zod';
import { ValidationError } from '@/errors/ValidationError';
import { NotFoundError } from '@/errors/NotFoundError';
import { PolicyDomainSchema, PolicyRuleArraySchema, type PolicyRule } from '@/lib/policy-engine/policy-types';
import { AdminRepository } from '@/repositories/admin/repository';
import type { ServiceContext } from '@/services/context';

export interface CreatePolicyInput {
  name: string;
  domain: string;
  rules: unknown;
  isActive?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

export interface UpdatePolicyInput {
  name?: string;
  domain?: string;
  rules: unknown;
  isActive?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export class PolicyAdminService {
  private readonly repository: AdminRepository;

  constructor(private readonly context: ServiceContext, repository?: AdminRepository) {
    this.repository = repository ?? new AdminRepository({ organizationId: context.organizationId });
  }

  async createPolicy(input: CreatePolicyInput) {
    const domain = PolicyDomainSchema.parse(input.domain);
    const rules = this.validateRules(input.rules);

    return this.repository.createPolicy({
      name: input.name,
      domain,
      rules,
      createdBy: this.context.userId,
      isActive: input.isActive ?? false,
      effectiveFrom: input.effectiveFrom ?? todayDate(),
      effectiveTo: input.effectiveTo ?? null
    });
  }

  async updatePolicy(policyId: string, input: UpdatePolicyInput) {
    const existing = await this.repository.getPolicy(policyId);
    if (!existing) {
      throw new NotFoundError('Policy not found');
    }

    return this.repository.updatePolicy({
      policyId,
      name: input.name,
      domain: input.domain ? PolicyDomainSchema.parse(input.domain) : undefined,
      rules: this.validateRules(input.rules),
      isActive: input.isActive,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo
    });
  }

  async activatePolicy(policyId: string) {
    const existing = await this.repository.getPolicy(policyId);
    if (!existing) {
      throw new NotFoundError('Policy not found');
    }

    return this.repository.activatePolicy(policyId, todayDate());
  }

  async deactivatePolicy(policyId: string) {
    const existing = await this.repository.getPolicy(policyId);
    if (!existing) {
      throw new NotFoundError('Policy not found');
    }

    return this.repository.deactivatePolicy(policyId, todayDate());
  }

  async getPolicy(policyId: string) {
    const policy = await this.repository.getPolicy(policyId);
    if (!policy) {
      throw new NotFoundError('Policy not found');
    }

    return policy;
  }

  listPolicies(domain?: string) {
    return this.repository.listPolicies(domain ? PolicyDomainSchema.parse(domain) : undefined);
  }

  validateRules(rules: unknown): PolicyRule[] {
    try {
      const parsed = PolicyRuleArraySchema.parse(rules);
      if (parsed.length === 0) {
        throw new ValidationError('At least one policy rule is required');
      }

      const duplicateRuleIds = collectDuplicates(parsed.map((rule) => rule.id));
      if (duplicateRuleIds.length > 0) {
        throw new ValidationError('Policy rules contain duplicate ids', { duplicateRuleIds });
      }

      return parsed;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      if (error instanceof ZodError) {
        throw new ValidationError('Policy rule DSL is invalid', {
          issues: error.issues.map((issue) => `${issue.path.join('.') || 'rules'}: ${issue.message}`)
        });
      }

      throw error;
    }
  }
}

function collectDuplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return Array.from(duplicates);
}
