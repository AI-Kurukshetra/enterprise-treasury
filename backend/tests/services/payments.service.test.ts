import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '@/errors/ConflictError';
import { NotFoundError } from '@/errors/NotFoundError';
import { PaymentExecutionError } from '@/errors/PaymentExecutionError';
import { PolicyViolationError } from '@/errors/PolicyViolationError';
import { ValidationError } from '@/errors/ValidationError';
import { PaymentsService } from '@/services/payments/service';
import { sha256 } from '@/utils/hash';
import { paymentFixture } from '../fixtures/treasury';
import { createServiceContext } from '../utils/context';

function createPaymentsService(overrides: {
  payment?: ReturnType<typeof paymentFixture> | null;
  paymentSequence?: Array<ReturnType<typeof paymentFixture> | null>;
  account?: { currency_code: string } | null;
  counterparty?: { id: string } | null;
  workflow?: { id: string } | null;
  policyWorkflow?: { id: string } | null;
  existingIdempotency?: {
    request_hash: string;
    status: 'in_progress' | 'completed' | 'failed';
    response_snapshot: Record<string, unknown> | null;
  } | null;
  existingPaymentByIdempotency?: ReturnType<typeof paymentFixture> | null;
  updateResult?: ReturnType<typeof paymentFixture> | null;
  createError?: Error;
  policyResult?: {
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
  };
} = {}) {
  const payment = overrides.payment === undefined ? paymentFixture() : overrides.payment;
  const paymentSequence = [...(overrides.paymentSequence ?? [])];
  const paymentsRepository = {
    list: vi.fn(),
    findByIdempotencyKey: vi.fn(async () => overrides.existingPaymentByIdempotency ?? null),
    create: vi.fn(async () => {
      if (overrides.createError) {
        throw overrides.createError;
      }
      return payment ?? paymentFixture();
    }),
    findById: vi.fn(async () => (paymentSequence.length > 0 ? paymentSequence.shift() ?? null : payment)),
    updateStatus: vi.fn(async () =>
      overrides.updateResult === undefined
        ? paymentFixture({ ...(payment ?? paymentFixture()), status: 'cancelled', version: (payment ?? paymentFixture()).version + 1 })
        : overrides.updateResult
    )
  };
  const accountsRepository = {
    getById: vi.fn(async () =>
      overrides.account === undefined ? { currency_code: (payment ?? paymentFixture()).currency_code } : overrides.account
    )
  };
  const approvalsRepository = {
    getActiveWorkflow: vi.fn(async () => (overrides.workflow === undefined ? { id: 'workflow-1' } : overrides.workflow)),
    getPolicyWorkflow: vi.fn(async () => overrides.policyWorkflow ?? null),
    listWorkflowSteps: vi.fn(async () => []),
    listActiveUserIdsByRole: vi.fn(async () => [])
  };
  const idempotencyRepository = {
    find: vi.fn(async () => overrides.existingIdempotency ?? null),
    createInProgress: vi.fn(async () => undefined),
    markCompleted: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined)
  };
  const counterpartiesRepository = {
    findById: vi.fn(async () => (overrides.counterparty === undefined ? { id: 'cp-1' } : overrides.counterparty))
  };
  const notificationsService = {
    paymentApprovalRequired: vi.fn(async () => undefined)
  };
  const policyEvaluator = {
    evaluate: vi.fn(async () => ({
      allowed: true,
      action: 'allow',
      violations: [],
      warnings: [],
      ...(overrides.policyResult ?? {})
    }))
  };

  return {
    service: new PaymentsService(
      createServiceContext(),
      paymentsRepository as never,
      accountsRepository as never,
      idempotencyRepository as never,
      approvalsRepository as never,
      counterpartiesRepository as never,
      notificationsService as never,
      policyEvaluator as never
    ),
    paymentsRepository,
    accountsRepository,
    approvalsRepository,
    idempotencyRepository,
    counterpartiesRepository,
    notificationsService,
    policyEvaluator,
    payment
  };
}

describe('PaymentsService', () => {
  it('rejects negative or zero amounts', async () => {
    const { service } = createPaymentsService();

    await expect(
      service.create(
        {
          paymentReference: 'PAY-1',
          sourceAccountId: 'acc-1',
          beneficiaryCounterpartyId: 'cp-1',
          amount: '0.000000',
          currencyCode: 'USD',
          valueDate: '2026-03-14'
        },
        'user-1',
        'idem-1'
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects missing source accounts', async () => {
    const { service } = createPaymentsService({ account: null });

    await expect(
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
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects account and payment currency mismatches', async () => {
    const { service } = createPaymentsService({ account: { currency_code: 'EUR' } });

    await expect(
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
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects payment creation when no active workflow exists', async () => {
    const { service } = createPaymentsService({ workflow: null });

    await expect(
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
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('blocks payments when the policy engine returns violations', async () => {
    const { service } = createPaymentsService({
      policyResult: {
        allowed: false,
        action: 'block',
        violations: [
          {
            policyId: 'policy-1',
            policyName: 'High value control',
            ruleId: 'rule-1',
            ruleName: 'Limit',
            action: 'block',
            message: 'Payment exceeds threshold'
          }
        ],
        warnings: []
      }
    });

    await expect(
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
    ).rejects.toBeInstanceOf(PolicyViolationError);
  });

  it('stores policy warnings in payment notes and assigns escalated workflow when approval is required', async () => {
    const created = paymentFixture({ approval_workflow_id: 'workflow-escalated', notes: 'Policy evaluation notes:\n- [require_approval] CFO review required' });
    const { service, paymentsRepository, approvalsRepository } = createPaymentsService({
      payment: created,
      policyWorkflow: { id: 'workflow-escalated' },
      policyResult: {
        allowed: true,
        action: 'require_approval',
        violations: [],
        warnings: [
          {
            policyId: 'policy-1',
            policyName: 'Escalations',
            ruleId: 'rule-2',
            ruleName: 'Escalate',
            action: 'require_approval',
            message: 'CFO review required'
          }
        ]
      }
    });

    await service.create(
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
    );

    expect(approvalsRepository.getPolicyWorkflow).toHaveBeenCalledWith(['rule-2']);
    expect(paymentsRepository.create).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'idem-1',
      expect.any(String),
      'workflow-escalated',
      expect.objectContaining({
        status: 'pending_approval',
        notes: expect.stringContaining('CFO review required')
      })
    );
  });

  it('returns completed idempotent snapshots for replayed payment requests', async () => {
    const createInput = {
      paymentReference: 'PAY-1',
      sourceAccountId: 'acc-1',
      beneficiaryCounterpartyId: 'cp-1',
      amount: '10.000000',
      currencyCode: 'USD',
      valueDate: '2026-03-14'
    };
    const replayed = paymentFixture({ id: 'pay-replayed', version: 2 });
    const { service, paymentsRepository } = createPaymentsService({
      existingIdempotency: {
        request_hash: sha256(JSON.stringify(createInput)),
        status: 'completed',
        response_snapshot: replayed as unknown as Record<string, unknown>
      }
    });

    const result = await service.create(createInput, 'user-1', 'idem-1');

    expect(result).toEqual(replayed);
    expect(paymentsRepository.create).not.toHaveBeenCalled();
  });

  it('rejects idempotency keys reused with a different payment payload', async () => {
    const { service } = createPaymentsService({
      existingIdempotency: {
        request_hash: 'different-hash',
        status: 'completed',
        response_snapshot: null
      }
    });

    await expect(
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
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('returns existing payments when the idempotency key already created one', async () => {
    const existing = paymentFixture({ id: 'pay-existing' });
    const { service, paymentsRepository } = createPaymentsService({ existingPaymentByIdempotency: existing });

    const result = await service.create(
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
    );

    expect(result).toEqual(existing);
    expect(paymentsRepository.create).not.toHaveBeenCalled();
  });

  it('falls back to the persisted payment when a completed idempotency snapshot is missing', async () => {
    const existing = paymentFixture({ id: 'pay-existing' });
    const createInput = {
      paymentReference: 'PAY-1',
      sourceAccountId: 'acc-1',
      beneficiaryCounterpartyId: 'cp-1',
      amount: '10.000000',
      currencyCode: 'USD',
      valueDate: '2026-03-14'
    };
    const { service, paymentsRepository } = createPaymentsService({
      existingIdempotency: {
        request_hash: sha256(JSON.stringify(createInput)),
        status: 'completed',
        response_snapshot: null
      },
      existingPaymentByIdempotency: existing
    });

    const result = await service.create(createInput, 'user-1', 'idem-1');

    expect(result).toEqual(existing);
    expect(paymentsRepository.create).not.toHaveBeenCalled();
  });

  it('returns the in-flight payment snapshot when an in-progress idempotent request already created one', async () => {
    const existing = paymentFixture({ id: 'pay-in-flight' });
    const { service, idempotencyRepository } = createPaymentsService({
      existingIdempotency: {
        request_hash: sha256(
          JSON.stringify({
            paymentReference: 'PAY-1',
            sourceAccountId: 'acc-1',
            beneficiaryCounterpartyId: 'cp-1',
            amount: '10.000000',
            currencyCode: 'USD',
            valueDate: '2026-03-14'
          })
        ),
        status: 'in_progress',
        response_snapshot: null
      },
      existingPaymentByIdempotency: existing
    });

    const result = await service.create(
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
    );

    expect(result).toEqual(existing);
    expect(idempotencyRepository.markCompleted).toHaveBeenCalledOnce();
  });

  it('rejects idempotent requests that are still in progress without a persisted payment', async () => {
    const { service } = createPaymentsService({
      existingIdempotency: {
        request_hash: sha256(
          JSON.stringify({
            paymentReference: 'PAY-1',
            sourceAccountId: 'acc-1',
            beneficiaryCounterpartyId: 'cp-1',
            amount: '10.000000',
            currencyCode: 'USD',
            valueDate: '2026-03-14'
          })
        ),
        status: 'in_progress',
        response_snapshot: null
      }
    });

    await expect(
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
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('marks idempotency as failed when creation throws', async () => {
    const { service, idempotencyRepository } = createPaymentsService({ createError: new Error('bank connector timeout') });

    await expect(
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
    ).rejects.toThrow('bank connector timeout');

    expect(idempotencyRepository.markFailed).toHaveBeenCalledOnce();
  });

  it('throws when looking up a missing payment by id', async () => {
    const { service } = createPaymentsService({ payment: null });
    await expect(service.getById('missing-payment')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('blocks cancelling executed payments', async () => {
    const { service } = createPaymentsService({ payment: paymentFixture({ status: 'settled' }) });
    await expect(service.cancel('payment-1')).rejects.toBeInstanceOf(PaymentExecutionError);
  });

  it('returns current payment when cancelling an already cancelled instruction', async () => {
    const cancelledPayment = paymentFixture({ status: 'cancelled' });
    const { service, paymentsRepository } = createPaymentsService({ payment: cancelledPayment });

    const result = await service.cancel(cancelledPayment.id);

    expect(result).toEqual(cancelledPayment);
    expect(paymentsRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('rejects stale cancellations when the payment version changes mid-flight', async () => {
    const pendingPayment = paymentFixture({ status: 'pending_approval' });
    const { service } = createPaymentsService({ payment: pendingPayment, updateResult: null });

    await expect(service.cancel(pendingPayment.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows retry only for failed payments and resets them to pending approval', async () => {
    const failedPayment = paymentFixture({ status: 'failed', version: 4 });
    const retriedPayment = paymentFixture({ status: 'pending_approval', version: 5 });
    const { service, paymentsRepository } = createPaymentsService({ payment: failedPayment, updateResult: retriedPayment });

    const result = await service.retry(failedPayment.id, 'retry-key-1');

    expect(result.status).toBe('pending_approval');
    expect(paymentsRepository.updateStatus).toHaveBeenCalledWith(failedPayment.id, 'pending_approval', failedPayment.version);
  });

  it('returns completed retry snapshots for replayed idempotent retries', async () => {
    const failedPayment = paymentFixture({ status: 'failed', version: 4 });
    const replayed = paymentFixture({ status: 'pending_approval', version: 5 });
    const { service } = createPaymentsService({
      payment: failedPayment,
      existingIdempotency: {
        request_hash: sha256(JSON.stringify({ paymentId: failedPayment.id })),
        status: 'completed',
        response_snapshot: replayed as unknown as Record<string, unknown>
      }
    });

    await expect(service.retry(failedPayment.id, 'retry-key-1')).resolves.toEqual(replayed);
  });

  it('returns the latest retried payment when an in-progress retry already succeeded', async () => {
    const failedPayment = paymentFixture({ status: 'failed', version: 4 });
    const updatedPayment = paymentFixture({ id: failedPayment.id, status: 'pending_approval', version: 5 });
    const { service, idempotencyRepository } = createPaymentsService({
      payment: failedPayment,
      paymentSequence: [failedPayment, updatedPayment],
      existingIdempotency: {
        request_hash: sha256(JSON.stringify({ paymentId: failedPayment.id })),
        status: 'in_progress',
        response_snapshot: null
      }
    });

    const result = await service.retry(failedPayment.id, 'retry-key-1');

    expect(result).toEqual(updatedPayment);
    expect(idempotencyRepository.markCompleted).toHaveBeenCalledWith(
      'payments.retry',
      'retry-key-1',
      updatedPayment as unknown as Record<string, unknown>
    );
  });

  it('rejects duplicate in-progress retries while the payment remains failed', async () => {
    const failedPayment = paymentFixture({ status: 'failed', version: 4 });
    const { service } = createPaymentsService({
      payment: failedPayment,
      paymentSequence: [failedPayment, failedPayment],
      existingIdempotency: {
        request_hash: sha256(JSON.stringify({ paymentId: failedPayment.id })),
        status: 'in_progress',
        response_snapshot: null
      }
    });

    await expect(service.retry(failedPayment.id, 'retry-key-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects retry idempotency keys reused with different payment ids', async () => {
    const failedPayment = paymentFixture({ status: 'failed', version: 4 });
    const { service } = createPaymentsService({
      payment: failedPayment,
      existingIdempotency: {
        request_hash: 'different-hash',
        status: 'completed',
        response_snapshot: null
      }
    });

    await expect(service.retry(failedPayment.id, 'retry-key-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects retries for non-failed payments', async () => {
    const { service } = createPaymentsService({ payment: paymentFixture({ status: 'approved' }) });
    await expect(service.retry('payment-1', 'retry-key-1')).rejects.toBeInstanceOf(ConflictError);
  });

  it('marks retry idempotency as failed when the payment version changes mid-retry', async () => {
    const failedPayment = paymentFixture({ status: 'failed', version: 4 });
    const { service, idempotencyRepository } = createPaymentsService({ payment: failedPayment, updateResult: null });

    await expect(service.retry(failedPayment.id, 'retry-key-1')).rejects.toBeInstanceOf(ConflictError);
    expect(idempotencyRepository.markFailed).toHaveBeenCalledOnce();
  });
});
