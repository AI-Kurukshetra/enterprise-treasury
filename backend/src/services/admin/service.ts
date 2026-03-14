import { AdminRepository, type AdminAuditLogFilters } from '@/repositories/admin/repository';
import type { PolicyRule } from '@/lib/policy-engine/policy-types';
import type { ServiceContext } from '@/services/context';

export class AdminService {
  private readonly repository: AdminRepository;

  constructor(context: ServiceContext, repository?: AdminRepository) {
    this.repository = repository ?? new AdminRepository({ organizationId: context.organizationId });
  }

  listUsers() {
    return this.repository.listUsers();
  }

  revokeUser(userId: string) {
    return this.repository.revokeUser(userId);
  }

  createRole(name: string, permissions: string[]) {
    return this.repository.createRole(name, permissions);
  }

  listRoles() {
    return this.repository.listRoles();
  }

  createPolicy(input: { name: string; domain: string; rules: PolicyRule[]; createdBy: string }) {
    return this.repository.createPolicy(input);
  }

  updatePolicy(input: {
    policyId: string;
    name?: string;
    domain?: string;
    rules: PolicyRule[];
    isActive?: boolean;
    effectiveFrom?: string;
    effectiveTo?: string | null;
  }) {
    return this.repository.updatePolicy(input);
  }

  listPolicies(domain?: string) {
    return this.repository.listPolicies(domain);
  }

  listAuditLogs(filters: AdminAuditLogFilters) {
    return this.repository.listAuditLogs(filters);
  }
}
