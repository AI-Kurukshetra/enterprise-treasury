import { describe, expect, it } from 'vitest';
import { PaymentsService } from '@/services/payments/service';
import { ConflictError } from '@/errors/ConflictError';
import { PolicyViolationError } from '@/errors/PolicyViolationError';
import { ValidationError } from '@/errors/ValidationError';

function createService(overrides?: {
  paymentsRepository?: {
    findByIdempotencyKey: (key: string) => Promise<unknown>;
    create: (...args: unknown[]) => Promise<unknown>;
    list: (...args: unknown[]) => Promise<unknown>;
    findById: (...args: unknown[]) => Promise<unknown>;
    updateStatus: (...args: unknown[]) => Promise<unknown>;
  };
  accountsRepository?: {
    getById: (id: string) => Promise<{ currency_code: string } | null>;
  };
  approvalsRepository?: {
    getActiveWorkflow: () => Promise<{ id: string } | null>;
    getPolicyWorkflow?: () => Promise<{ id: string } | null>;
    listWorkflowSteps?: () => Promise<Array<{ id: string; role_id: string }>>;
    listActiveUserIdsByRole?: () => Promise<string[]>;
  };
  idempotencyRepository?: {
    find: (...args: unknown[]) => Promise<{
      request_hash: string;
      status: 'in_progress' | 'completed' | 'failed';
      response_snapshot: Record<string, unknown> | null;
    } | null>;
    createInProgress: (...args: unknown[]) => Promise<unknown>;
    markCompleted: (...args: unknown[]) => Promise<void>;
    markFailed?: (...args: unknown[]) => Promise<void>;
  };
  counterpartiesRepository?: {
    findById: (id: string) => Promise<{ id: string } | null>;
  };
  notificationsService?: {
    paymentApprovalRequired: (...args: unknown[]) => Promise<void>;
  };
  policyEvaluator?: {
    evaluate: (...args: unknown[]) => Promise<{
      allowed: boolean;
      action: string;
      violations: Array<{
        policyId: string;
        policyName: string;
        ruleId: string;
        ruleName: string;
        action: 'block';
        message: string;
      }>;
      warnings: Array<{
        policyId: string;
        policyName: string;
        ruleId: string;
        ruleName: string;
        action: 'warn' | 'require_approval' | 'auto_approve';
        message: string;
      }>;
    }>;
  };
}) {
  return new PaymentsService(
    {
      organizationId: 'org-1',
      userId: 'user-1',
      requestId: 'req-1'
    },
    overrides?.paymentsRepository as never,
    overrides?.accountsRepository as never,
    overrides?.idempotencyRepository as never,
    overrides?.approvalsRepository as never,
    overrides?.counterpartiesRepository as never,
    overrides?.notificationsService as never,
    overrides?.policyEvaluator as never
  );
}

describe('PaymentsService', () => {
  it('rejects currency mismatch between account and payment', async () => {
    const service = createService({
      paymentsRepository: {
        findByIdempotencyKey: async () => null,
        create: async () => ({}),
        list: async () => ({}),
        findById: async () => null,
        updateStatus: async () => null
      },
      accountsRepository: {
        getById: async () => ({ currency_code: 'USD' })
      },
      approvalsRepository: {
        getActiveWorkflow: async () => ({ id: 'workflow-1' }),
        getPolicyWorkflow: async () => null,
        listWorkflowSteps: async () => [],
        listActiveUserIdsByRole: async () => []
      },
      idempotencyRepository: {
        find: async () => null,
        createInProgress: async () => ({}),
        markCompleted: async () => undefined
      },
      counterpartiesRepository: {
        findById: async () => ({ id: 'cp-1' })
      },
      notificationsService: {
        paymentApprovalRequired: async () => undefined
      },
      policyEvaluator: {
        evaluate: async () => ({ allowed: true, action: 'allow', violations: [], warnings: [] })
      }
    });

    await expect(
      service.create(
        {
          paymentReference: 'PAY-001',
          sourceAccountId: 'acc-1',
          beneficiaryCounterpartyId: 'cp-1',
          amount: '100.000000',
          currencyCode: 'EUR',
          valueDate: '2026-03-14'
        },
        'user-1',
        'idem-1'
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('blocks idempotency replay with different payload hash', async () => {
    const service = createService({
      paymentsRepository: {
        findByIdempotencyKey: async () => null,
        create: async () => ({}),
        list: async () => ({}),
        findById: async () => null,
        updateStatus: async () => null
      },
      accountsRepository: {
        getById: async () => ({ currency_code: 'USD' })
      },
      approvalsRepository: {
        getActiveWorkflow: async () => ({ id: 'workflow-1' }),
        getPolicyWorkflow: async () => null,
        listWorkflowSteps: async () => [],
        listActiveUserIdsByRole: async () => []
      },
      idempotencyRepository: {
        find: async () => ({
          request_hash: 'different-hash',
          status: 'completed',
          response_snapshot: null
        }),
        createInProgress: async () => ({}),
        markCompleted: async () => undefined
      },
      counterpartiesRepository: {
        findById: async () => ({ id: 'cp-1' })
      },
      notificationsService: {
        paymentApprovalRequired: async () => undefined
      },
      policyEvaluator: {
        evaluate: async () => ({ allowed: true, action: 'allow', violations: [], warnings: [] })
      }
    });

    await expect(
      service.create(
        {
          paymentReference: 'PAY-001',
          sourceAccountId: 'acc-1',
          beneficiaryCounterpartyId: 'cp-1',
          amount: '100.000000',
          currencyCode: 'USD',
          valueDate: '2026-03-14'
        },
        'user-1',
        'idem-1'
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws policy violations from the policy engine', async () => {
    const service = createService({
      paymentsRepository: {
        findByIdempotencyKey: async () => null,
        create: async () => ({}),
        list: async () => ({}),
        findById: async () => null,
        updateStatus: async () => null
      },
      accountsRepository: {
        getById: async () => ({ currency_code: 'USD' })
      },
      approvalsRepository: {
        getActiveWorkflow: async () => ({ id: 'workflow-1' }),
        getPolicyWorkflow: async () => null,
        listWorkflowSteps: async () => [],
        listActiveUserIdsByRole: async () => []
      },
      idempotencyRepository: {
        find: async () => null,
        createInProgress: async () => ({}),
        markCompleted: async () => undefined
      },
      counterpartiesRepository: {
        findById: async () => ({ id: 'cp-1' })
      },
      notificationsService: {
        paymentApprovalRequired: async () => undefined
      },
      policyEvaluator: {
        evaluate: async () => ({
          allowed: false,
          action: 'block',
          violations: [
            {
              policyId: 'policy-1',
              policyName: 'Limit',
              ruleId: 'rule-1',
              ruleName: 'Threshold',
              action: 'block',
              message: 'Too large'
            }
          ],
          warnings: []
        })
      }
    });

    await expect(
      service.create(
        {
          paymentReference: 'PAY-001',
          sourceAccountId: 'acc-1',
          beneficiaryCounterpartyId: 'cp-1',
          amount: '100.000000',
          currencyCode: 'USD',
          valueDate: '2026-03-14'
        },
        'user-1',
        'idem-1'
      )
    ).rejects.toBeInstanceOf(PolicyViolationError);
  });
});
