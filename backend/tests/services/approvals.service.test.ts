import { describe, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@/errors/AuthorizationError';
import { ConflictError } from '@/errors/ConflictError';
import { NotFoundError } from '@/errors/NotFoundError';
import { ApprovalsService } from '@/services/approvals/service';
import { paymentFixture } from '../fixtures/treasury';
import { createServiceContext } from '../utils/context';

const workflowSteps = [
  { id: 'step-1', workflow_id: 'workflow-1', role_id: 'role-approver', step_order: 1, min_approvals: 1 },
  { id: 'step-2', workflow_id: 'workflow-1', role_id: 'role-final', step_order: 2, min_approvals: 1 }
];

function createApprovalsService(overrides: {
  payment?: ReturnType<typeof paymentFixture> | null;
  userRoleId?: string | null;
  steps?: typeof workflowSteps;
  decisions?: Array<{ payment_id: string; approval_step_id: string; approver_user_id: string; decision: 'approved' | 'rejected' }>;
  pendingPayments?: Array<{
    id: string;
    paymentReference: string;
    amount: string;
    currencyCode: string;
    valueDate: string;
    createdAt: string;
    rowVersionToken: string;
    approvalWorkflowId: string;
  }>;
  updatedPayment?: ReturnType<typeof paymentFixture> | null;
} = {}) {
  const payment = overrides.payment === undefined ? paymentFixture({ approval_workflow_id: 'workflow-1', version: 1 }) : overrides.payment;
  const pendingPayment =
    payment === null
      ? {
          id: 'payment-fallback',
          paymentReference: 'PAY-FALLBACK',
          amount: '1.000000',
          currencyCode: 'USD',
          valueDate: '2026-03-14',
          createdAt: '2026-03-14T09:00:00.000Z',
          rowVersionToken: '1',
          approvalWorkflowId: 'workflow-1'
        }
      : {
          id: payment.id,
          paymentReference: payment.payment_reference,
          amount: payment.amount,
          currencyCode: payment.currency_code,
          valueDate: payment.value_date,
          createdAt: payment.created_at,
          rowVersionToken: String(payment.version),
          approvalWorkflowId: payment.approval_workflow_id ?? 'workflow-1'
        };
  const approvalsRepository = {
    getUserRoleId: vi.fn(async () => (overrides.userRoleId === undefined ? 'role-approver' : overrides.userRoleId)),
    listPendingPayments: vi.fn(async () => overrides.pendingPayments ?? [
      pendingPayment
    ]),
    listPaymentDecisions: vi.fn(async () => overrides.decisions ?? []),
    listWorkflowSteps: vi.fn(async () => overrides.steps ?? workflowSteps),
    listActiveUserIdsByRole: vi.fn(async () => ['approver-2']),
    saveDecision: vi.fn(async () => undefined)
  };
  const updateBasePayment = payment ?? paymentFixture({ approval_workflow_id: 'workflow-1', version: 1 });
  const paymentsRepository = {
    findById: vi.fn(async () => payment),
    updateStatus: vi.fn(async () =>
      overrides.updatedPayment === undefined
        ? paymentFixture({ ...updateBasePayment, status: 'approved', version: updateBasePayment.version + 1 })
        : overrides.updatedPayment
    )
  };
  const notificationsService = {
    paymentApprovalRequired: vi.fn(async () => undefined),
    paymentApproved: vi.fn(async () => undefined),
    paymentRejected: vi.fn(async () => undefined)
  };

  return {
    service: new ApprovalsService(
      createServiceContext(),
      approvalsRepository as never,
      paymentsRepository as never,
      notificationsService as never
    ),
    approvalsRepository,
    paymentsRepository,
    notificationsService,
    payment
  };
}

describe('ApprovalsService', () => {
  it('lists only approvals assigned to the current approver role', async () => {
    const { service } = createApprovalsService();
    const result = await service.listPending('user-1');
    expect(result).toHaveLength(1);
    expect(result[0]?.rowVersionToken).toBe('1');
  });

  it('returns no pending approvals when the user has no active role', async () => {
    const { service } = createApprovalsService({ userRoleId: null });
    await expect(service.listPending('user-1')).resolves.toEqual([]);
  });

  it('filters out payments that the approver has already decided', async () => {
    const { service } = createApprovalsService({
      steps: [{ id: 'step-1', workflow_id: 'workflow-1', role_id: 'role-approver', step_order: 1, min_approvals: 2 }],
      decisions: [{ payment_id: '00000000-0000-4000-8000-000000000401', approval_step_id: 'step-1', approver_user_id: 'user-1', decision: 'approved' }]
    });

    await expect(service.listPending('user-1')).resolves.toEqual([]);
  });

  it('rejects approval when the payment cannot be found', async () => {
    const { service } = createApprovalsService({ payment: null });
    await expect(service.approve({ paymentId: 'missing', rowVersionToken: '1' }, 'approver-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects stale row version tokens', async () => {
    const { service } = createApprovalsService();
    await expect(service.approve({ paymentId: 'pay-1', rowVersionToken: '99' }, 'approver-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects unauthorized approvers for the current approval step', async () => {
    const { service } = createApprovalsService({ userRoleId: 'role-other' });
    await expect(service.approve({ paymentId: 'pay-1', rowVersionToken: '1' }, 'approver-1')).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('rejects approvals when the payment state changes during persistence', async () => {
    const { service } = createApprovalsService({ updatedPayment: null });
    await expect(service.approve({ paymentId: 'pay-1', rowVersionToken: '1' }, 'approver-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('prevents duplicate decisions on the same approval step', async () => {
    const { service } = createApprovalsService({
      steps: [{ id: 'step-1', workflow_id: 'workflow-1', role_id: 'role-approver', step_order: 1, min_approvals: 2 }],
      decisions: [{ payment_id: '00000000-0000-4000-8000-000000000401', approval_step_id: 'step-1', approver_user_id: 'approver-1', decision: 'approved' }]
    });

    await expect(
      service.approve({ paymentId: '00000000-0000-4000-8000-000000000401', rowVersionToken: '1' }, 'approver-1')
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects approvals when the payment is no longer pending approval', async () => {
    const { service } = createApprovalsService({ payment: paymentFixture({ status: 'approved', approval_workflow_id: 'workflow-1' }) });
    await expect(service.approve({ paymentId: 'pay-1', rowVersionToken: '1' }, 'approver-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects approvals when the workflow linkage is missing', async () => {
    const { service } = createApprovalsService({
      payment: {
        ...paymentFixture({ status: 'pending_approval' }),
        approval_workflow_id: null
      }
    });
    await expect(service.approve({ paymentId: 'pay-1', rowVersionToken: '1' }, 'approver-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('keeps payments pending when only an intermediate approval step completes', async () => {
    const pendingPayment = paymentFixture({ status: 'pending_approval', version: 2 });
    const { service, paymentsRepository } = createApprovalsService({
      steps: workflowSteps,
      updatedPayment: pendingPayment
    });

    const result = await service.approve({ paymentId: '00000000-0000-4000-8000-000000000401', rowVersionToken: '1' }, 'approver-1');

    expect(result.status).toBe('pending_approval');
    expect(paymentsRepository.updateStatus).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000401', 'pending_approval', 1);
  });

  it('approves final-step payments and advances status', async () => {
    const approvedPayment = paymentFixture({ status: 'approved', version: 2 });
    const { service, approvalsRepository, paymentsRepository } = createApprovalsService({
      steps: [{ id: 'step-1', workflow_id: 'workflow-1', role_id: 'role-approver', step_order: 1, min_approvals: 1 }],
      updatedPayment: approvedPayment
    });

    const result = await service.approve({ paymentId: approvedPayment.id, rowVersionToken: '1' }, 'approver-1');

    expect(result.status).toBe('approved');
    expect(approvalsRepository.saveDecision).toHaveBeenCalledOnce();
    expect(paymentsRepository.updateStatus).toHaveBeenCalledWith(approvedPayment.id, 'approved', 1);
  });

  it('rejects pending approvals with a rejected outcome', async () => {
    const rejectedPayment = paymentFixture({ status: 'rejected', version: 2 });
    const { service, approvalsRepository, paymentsRepository } = createApprovalsService({ updatedPayment: rejectedPayment });

    const result = await service.reject({ paymentId: rejectedPayment.id, rowVersionToken: '1', comment: 'policy breach' }, 'approver-1');

    expect(result.status).toBe('rejected');
    expect(approvalsRepository.saveDecision).toHaveBeenCalledOnce();
    expect(paymentsRepository.updateStatus).toHaveBeenCalledWith(rejectedPayment.id, 'rejected', 1);
  });

  it('rejects rejections when the approver has no active role', async () => {
    const { service } = createApprovalsService({ userRoleId: null });
    await expect(service.reject({ paymentId: 'pay-1', rowVersionToken: '1' }, 'approver-1')).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('rejects rejections for unauthorized approvers on the current step', async () => {
    const { service } = createApprovalsService({ userRoleId: 'role-other' });
    await expect(service.reject({ paymentId: 'pay-1', rowVersionToken: '1' }, 'approver-1')).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('rejects rejections when the payment is no longer pending approval', async () => {
    const { service } = createApprovalsService({ payment: paymentFixture({ status: 'approved', approval_workflow_id: 'workflow-1' }) });
    await expect(service.reject({ paymentId: 'pay-1', rowVersionToken: '1' }, 'approver-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects rejections when the payment state changes during persistence', async () => {
    const { service } = createApprovalsService({ updatedPayment: null });
    await expect(service.reject({ paymentId: 'pay-1', rowVersionToken: '1' }, 'approver-1')).rejects.toBeInstanceOf(ConflictError);
  });
});
