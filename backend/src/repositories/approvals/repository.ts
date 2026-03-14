import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { PendingApprovalItem } from '@/types/approvals/types';

interface PendingPaymentRow {
  id: string;
  payment_reference: string;
  amount: string;
  currency_code: string;
  value_date: string;
  created_at: string;
  version: number;
  approval_workflow_id: string | null;
}

interface ApprovalStepRow {
  id: string;
  workflow_id: string;
  role_id: string;
  step_order: number;
  min_approvals: number;
}

interface PaymentDecisionRow {
  payment_id: string;
  approval_step_id: string;
  approver_user_id: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  decided_at: string;
}

interface RoleRow {
  id: string;
  name: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
}

export interface ApprovalWorkflow {
  id: string;
  conditions?: Record<string, unknown> | null;
}

export interface ApprovalStep {
  id: string;
  workflow_id: string;
  role_id: string;
  step_order: number;
  min_approvals: number;
}

export interface PaymentDecision {
  payment_id: string;
  approval_step_id: string;
  approver_user_id: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  decided_at: string;
}

export interface PendingApprovalPayment {
  id: string;
  paymentReference: string;
  amount: string;
  currencyCode: string;
  valueDate: string;
  createdAt: string;
  rowVersionToken: string;
  approvalWorkflowId: string;
}

export class ApprovalsRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async getUserRoleId(userId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('organization_memberships')
      .select('role_id')
      .eq('organization_id', this.context.organizationId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    assertNoQueryError(error);
    return ((data as { role_id: string } | null) ?? null)?.role_id ?? null;
  }

  async getActiveWorkflow(domain: 'payments'): Promise<ApprovalWorkflow | null> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.db
      .from('approval_workflows')
      .select('id,conditions')
      .eq('organization_id', this.context.organizationId)
      .eq('domain', domain)
      .eq('is_active', true)
      .lte('effective_from', nowIso)
      .or(`effective_to.is.null,effective_to.gt.${nowIso}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as ApprovalWorkflow | null) ?? null;
  }

  async getPolicyWorkflow(ruleIds: string[]): Promise<ApprovalWorkflow | null> {
    if (ruleIds.length === 0) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await this.db
      .from('approval_workflows')
      .select('id,conditions')
      .eq('organization_id', this.context.organizationId)
      .eq('domain', 'payments')
      .eq('is_active', true)
      .lte('effective_from', nowIso)
      .or(`effective_to.is.null,effective_to.gt.${nowIso}`)
      .order('effective_from', { ascending: false });

    assertNoQueryError(error);

    const workflows = (data ?? []) as ApprovalWorkflow[];
    const exactMatch = workflows.find((workflow) => {
      const policyRuleId = workflow.conditions?.policyRuleId;
      const policyRuleIds = workflow.conditions?.policyRuleIds;

      if (typeof policyRuleId === 'string' && ruleIds.includes(policyRuleId)) {
        return true;
      }

      return Array.isArray(policyRuleIds) && policyRuleIds.some((value) => typeof value === 'string' && ruleIds.includes(value));
    });
    if (exactMatch) {
      return exactMatch;
    }

    const genericPolicyWorkflow = workflows.find((workflow) => {
      const source = workflow.conditions?.source;
      const policyAction = workflow.conditions?.policyAction;
      return source === 'policy_engine' || policyAction === 'require_approval';
    });

    return genericPolicyWorkflow ?? null;
  }

  async listWorkflowSteps(workflowId: string): Promise<ApprovalStep[]> {
    const { data, error } = await this.db
      .from('approval_steps')
      .select('id,workflow_id,role_id,step_order,min_approvals')
      .eq('organization_id', this.context.organizationId)
      .eq('workflow_id', workflowId)
      .order('step_order', { ascending: true });

    assertNoQueryError(error);
    return (data ?? []) as ApprovalStepRow[];
  }

  async listPaymentDecisions(paymentIds: string[]): Promise<PaymentDecision[]> {
    if (paymentIds.length === 0) {
      return [];
    }

    const { data, error } = await this.db
      .from('payment_approvals')
      .select('payment_id,approval_step_id,approver_user_id,decision,comment,decided_at')
      .eq('organization_id', this.context.organizationId)
      .in('payment_id', paymentIds);

    assertNoQueryError(error);
    return (data ?? []) as PaymentDecisionRow[];
  }

  async getRolesByIds(roleIds: string[]): Promise<Map<string, string>> {
    if (roleIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.db
      .from('roles')
      .select('id,name')
      .eq('organization_id', this.context.organizationId)
      .in('id', roleIds);

    assertNoQueryError(error);
    return new Map(((data ?? []) as RoleRow[]).map((row) => [row.id, row.name]));
  }

  async getUsersByIds(userIds: string[]): Promise<Map<string, UserRow>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const { data, error } = await this.db
      .from('users')
      .select('id,email,display_name')
      .in('id', userIds);

    assertNoQueryError(error);
    return new Map(((data ?? []) as UserRow[]).map((row) => [row.id, row]));
  }

  async listActiveUserIdsByRole(roleId: string): Promise<string[]> {
    const { data, error } = await this.db
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', this.context.organizationId)
      .eq('role_id', roleId)
      .eq('status', 'active');

    assertNoQueryError(error);
    return Array.from(
      new Set(
        ((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id).filter((value): value is string => Boolean(value))
      )
    );
  }

  async listPendingPayments(): Promise<PendingApprovalPayment[]> {
    const { data, error } = await this.db
      .from('payments')
      .select('id,payment_reference,amount,currency_code,value_date,created_at,version,approval_workflow_id')
      .eq('organization_id', this.context.organizationId)
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: true });

    assertNoQueryError(error);

    const rows = (data ?? []) as PendingPaymentRow[];
    return rows.map((row) => ({
      id: row.id,
      paymentReference: row.payment_reference,
      amount: row.amount,
      currencyCode: row.currency_code,
      valueDate: row.value_date,
      createdAt: row.created_at,
      rowVersionToken: String(row.version),
      approvalWorkflowId: row.approval_workflow_id ?? ''
    }));
  }

  async saveDecision(input: {
    paymentId: string;
    approvalStepId: string;
    approverUserId: string;
    decision: 'approved' | 'rejected';
    comment?: string;
  }): Promise<void> {
    const { error } = await this.db.from('payment_approvals').insert({
      organization_id: this.context.organizationId,
      payment_id: input.paymentId,
      approval_step_id: input.approvalStepId,
      approver_user_id: input.approverUserId,
      decision: input.decision,
      comment: input.comment ?? null,
      decided_at: new Date().toISOString()
    });

    assertNoQueryError(error);
  }
}
