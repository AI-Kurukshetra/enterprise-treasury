import { describe, expect, it } from 'vitest';
import { ConflictError } from '@/errors/ConflictError';
import { PaymentsService } from '@/services/payments/service';
import { ApprovalsService } from '@/services/approvals/service';
import { createServiceContext } from '../utils/context';
import { paymentFixture } from '../fixtures/treasury';

describe('concurrency protections', () => {
  it('processes duplicate payment submissions with the same idempotency key only once', async () => {
    let idempotencyCreated = false;
    let createdPayments = 0;
    const payment = paymentFixture({ status: 'pending_approval' });

    const service = new PaymentsService(
      createServiceContext(),
      {
        list: async () => ({ items: [], nextCursor: null }),
        findByIdempotencyKey: async () => (createdPayments > 0 ? payment : null),
        create: async () => {
          createdPayments += 1;
          return payment;
        },
        findById: async () => payment,
        updateStatus: async () => payment
      } as never,
      {
        getById: async () => ({ currency_code: 'USD' })
      } as never,
      {
        find: async () => null,
        createInProgress: async () => {
          if (idempotencyCreated) {
            throw new ConflictError('Duplicate in-flight request');
          }
          idempotencyCreated = true;
        },
        markCompleted: async () => undefined,
        markFailed: async () => undefined
      } as never,
      {
        getActiveWorkflow: async () => ({ id: 'workflow-1' }),
        getPolicyWorkflow: async () => null,
        listWorkflowSteps: async () => [{ id: 'step-1', workflow_id: 'workflow-1', role_id: 'role-approver', step_order: 1, min_approvals: 1 }],
        listActiveUserIdsByRole: async () => ['approver-1']
      } as never,
      {
        findById: async () => ({ id: 'cp-1', name: 'Counterparty' })
      } as never,
      {
        paymentApprovalRequired: async () => undefined
      } as never,
      {
        evaluate: async () => ({
          allowed: true,
          action: 'require_approval',
          violations: [],
          warnings: []
        })
      } as never
    );

    const results = await Promise.allSettled([
      service.create(
        {
          paymentReference: 'PAY-1',
          sourceAccountId: 'acc-1',
          beneficiaryCounterpartyId: 'cp-1',
          amount: '10.000000',
          currencyCode: 'USD',
          valueDate: '2026-03-14'
        },
        'user-1',
        'idem-1'
      ),
      service.create(
        {
          paymentReference: 'PAY-1',
          sourceAccountId: 'acc-1',
          beneficiaryCounterpartyId: 'cp-1',
          amount: '10.000000',
          currencyCode: 'USD',
          valueDate: '2026-03-14'
        },
        'user-1',
        'idem-1'
      )
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(createdPayments).toBe(1);
  });

  it('prevents duplicate approvals on the same step under parallel decisions', async () => {
    const payment = paymentFixture({ approval_workflow_id: 'workflow-1', version: 1, status: 'pending_approval' });
    const savedDecisions = new Set<string>();

    const service = new ApprovalsService(
      createServiceContext(),
      {
        getUserRoleId: async () => 'role-approver',
        listPendingPayments: async () => [],
        listPaymentDecisions: async () => [],
        listWorkflowSteps: async () => [{ id: 'step-1', workflow_id: 'workflow-1', role_id: 'role-approver', step_order: 1, min_approvals: 1 }],
        listActiveUserIdsByRole: async () => ['approver-1'],
        saveDecision: async ({ approverUserId, approvalStepId }: { approverUserId: string; approvalStepId: string }) => {
          const key = `${approvalStepId}:${approverUserId}`;
          if (savedDecisions.has(key)) {
            throw new ConflictError('Approver has already recorded a decision for this step');
          }
          savedDecisions.add(key);
        }
      } as never,
      {
        findById: async () => payment,
        updateStatus: async () => paymentFixture({ ...payment, status: 'approved', version: 2 })
      } as never,
      {
        paymentApproved: async () => undefined,
        paymentApprovalRequired: async () => undefined,
        paymentRejected: async () => undefined
      } as never
    );

    const results = await Promise.allSettled([
      service.approve({ paymentId: payment.id, rowVersionToken: '1' }, 'approver-1'),
      service.approve({ paymentId: payment.id, rowVersionToken: '1' }, 'approver-1')
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(savedDecisions.size).toBe(1);
  });
});
