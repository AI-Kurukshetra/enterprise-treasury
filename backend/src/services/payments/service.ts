import type { PaginationInput } from '@/types/common';
import { ConflictError } from '@/errors/ConflictError';
import { NotFoundError } from '@/errors/NotFoundError';
import { PolicyViolationError } from '@/errors/PolicyViolationError';
import { ValidationError } from '@/errors/ValidationError';
import { PaymentExecutionError } from '@/errors/PaymentExecutionError';
import { PolicyEvaluator } from '@/lib/policy-engine/policy-evaluator';
import type { PolicyWarning } from '@/lib/policy-engine/policy-types';
import { AccountsRepository } from '@/repositories/accounts/repository';
import { ApprovalsRepository } from '@/repositories/approvals/repository';
import { CounterpartiesRepository } from '@/repositories/counterparties/repository';
import { IdempotencyRepository } from '@/repositories/payments/idempotencyRepository';
import { PaymentsRepository } from '@/repositories/payments/repository';
import { withTransactionBoundary } from '@/lib/transaction';
import type {
  CreatePaymentInput,
  PaymentApprovalChainDetail,
  PaymentApprovalStepDetail,
  PaymentDetail,
  PaymentFilters
} from '@/types/payments/types';
import type { ApprovalStep, PaymentDecision } from '@/repositories/approvals/repository';
import { compareDecimalStrings } from '@/utils/money';
import { sha256 } from '@/utils/hash';
import type { ServiceContext } from '@/services/context';
import { NotificationsService } from '@/services/notifications/service';

function getCurrentApprovalStep(steps: ApprovalStep[], decisions: PaymentDecision[]): ApprovalStep | null {
  for (const step of steps) {
    const stepDecisions = decisions.filter((decision) => decision.approval_step_id === step.id);
    const rejectedDecision = stepDecisions.find((decision) => decision.decision === 'rejected');
    if (rejectedDecision) {
      return null;
    }

    const approvals = stepDecisions.filter((decision) => decision.decision === 'approved').length;
    if (approvals < step.min_approvals) {
      return step;
    }
  }

  return null;
}

export class PaymentsService {
  private readonly context: ServiceContext;
  private readonly paymentsRepository: PaymentsRepository;
  private readonly accountsRepository: AccountsRepository;
  private readonly approvalsRepository: ApprovalsRepository;
  private readonly idempotencyRepository: IdempotencyRepository;
  private readonly counterpartiesRepository: CounterpartiesRepository;
  private readonly notificationsService: NotificationsService;
  private readonly policyEvaluator: Pick<PolicyEvaluator, 'evaluate'>;

  constructor(
    context: ServiceContext,
    paymentsRepository?: PaymentsRepository,
    accountsRepository?: AccountsRepository,
    idempotencyRepository?: IdempotencyRepository,
    approvalsRepository?: ApprovalsRepository,
    counterpartiesRepository?: CounterpartiesRepository,
    notificationsService?: NotificationsService,
    policyEvaluator?: Pick<PolicyEvaluator, 'evaluate'>
  ) {
    this.context = context;
    this.paymentsRepository = paymentsRepository ?? new PaymentsRepository({ organizationId: context.organizationId });
    this.accountsRepository = accountsRepository ?? new AccountsRepository({ organizationId: context.organizationId });
    this.idempotencyRepository =
      idempotencyRepository ?? new IdempotencyRepository({ organizationId: context.organizationId });
    this.approvalsRepository = approvalsRepository ?? new ApprovalsRepository({ organizationId: context.organizationId });
    this.counterpartiesRepository =
      counterpartiesRepository ?? new CounterpartiesRepository({ organizationId: context.organizationId });
    this.notificationsService = notificationsService ?? new NotificationsService(context);
    this.policyEvaluator = policyEvaluator ?? new PolicyEvaluator(context);
  }

  list(filters: PaymentFilters, pagination: PaginationInput) {
    return this.paymentsRepository.list(filters, pagination);
  }

  async create(input: CreatePaymentInput, actorUserId: string, idempotencyKey: string) {
    if (compareDecimalStrings(input.amount, '0') <= 0) {
      throw new ValidationError('Payment amount must be positive');
    }

    const account = await this.accountsRepository.getById(input.sourceAccountId);
    if (!account) {
      throw new NotFoundError('Source account not found');
    }

    if (account.currency_code !== input.currencyCode) {
      throw new ValidationError('Currency mismatch between account and payment', {
        accountCurrency: account.currency_code,
        paymentCurrency: input.currencyCode
      });
    }

    const counterparty = await this.counterpartiesRepository.findById(input.beneficiaryCounterpartyId);
    if (!counterparty) {
      throw new NotFoundError('Beneficiary counterparty not found');
    }

    const requestHash = sha256(JSON.stringify(input));
    const existingIdempotency = await this.idempotencyRepository.find('payments.create', idempotencyKey);

    if (existingIdempotency) {
      if (existingIdempotency.request_hash !== requestHash) {
        throw new ConflictError('Idempotency key was already used with a different request payload');
      }

      if (existingIdempotency.status === 'completed' && existingIdempotency.response_snapshot) {
        return existingIdempotency.response_snapshot;
      }

      if (existingIdempotency.status === 'in_progress') {
        const inFlightPayment = await this.paymentsRepository.findByIdempotencyKey(idempotencyKey);
        if (inFlightPayment) {
          await this.idempotencyRepository.markCompleted('payments.create', idempotencyKey, inFlightPayment as unknown as Record<string, unknown>);
          return inFlightPayment;
        }

        throw new ConflictError('Payment request is already being processed');
      }
    }

    const existingPayment = await this.paymentsRepository.findByIdempotencyKey(idempotencyKey);
    if (existingPayment) {
      return existingPayment;
    }

    const policyResult = await this.policyEvaluator.evaluate(this.context.organizationId, {
      domain: 'payment',
      payment: {
        amount: input.amount,
        currency: input.currencyCode,
        counterpartyId: input.beneficiaryCounterpartyId,
        sourceAccountId: input.sourceAccountId
      }
    });

    if (!policyResult.allowed) {
      throw new PolicyViolationError('Payment blocked by policy', policyResult.violations);
    }

    const defaultApprovalWorkflow = await this.approvalsRepository.getActiveWorkflow('payments');
    const policyWorkflowRuleIds = policyResult.warnings
      .filter((warning) => warning.action === 'require_approval')
      .map((warning) => warning.ruleId);
    const approvalWorkflow =
      (policyWorkflowRuleIds.length > 0
        ? await this.approvalsRepository.getPolicyWorkflow(policyWorkflowRuleIds)
        : null) ?? defaultApprovalWorkflow;

    if (!approvalWorkflow) {
      throw new ConflictError('No active payment approval workflow is configured');
    }

    const initialStatus = policyResult.action === 'auto_approve' ? 'approved' : 'pending_approval';
    const paymentNotes = buildPolicyNotes(policyResult.warnings);

    return withTransactionBoundary('payments.create', async () => {
      await this.idempotencyRepository.createInProgress('payments.create', idempotencyKey, requestHash);

      try {
        const payment = await this.paymentsRepository.create(
          input,
          actorUserId,
          idempotencyKey,
          this.context.requestId,
          approvalWorkflow.id,
          {
            status: initialStatus,
            notes: paymentNotes
          }
        );

        await this.idempotencyRepository.markCompleted(
          'payments.create',
          idempotencyKey,
          {
            ...payment,
            policy_warnings: policyResult.warnings
          } as unknown as Record<string, unknown>
        );

        const workflowSteps = initialStatus === 'pending_approval'
          ? await this.approvalsRepository.listWorkflowSteps(approvalWorkflow.id)
          : [];
        const firstStep = workflowSteps[0];
        if (firstStep) {
          const approverUserIds = await this.approvalsRepository.listActiveUserIdsByRole(firstStep.role_id);
          await Promise.all(
            approverUserIds.map((approverUserId) =>
              this.notificationsService.paymentApprovalRequired(payment, approverUserId)
            )
          );
        }

        return {
          ...payment,
          policy_warnings: policyResult.warnings
        };
      } catch (error) {
        await this.idempotencyRepository.markFailed(
          'payments.create',
          idempotencyKey,
          error instanceof Error ? error.message : 'Unknown payment create failure'
        );
        throw error;
      }
    });
  }

  async getById(paymentId: string) {
    const payment = await this.paymentsRepository.findById(paymentId);
    if (!payment) {
      throw new NotFoundError('Payment not found');
    }
    return payment;
  }

  async getDetail(paymentId: string, viewerUserId: string): Promise<PaymentDetail> {
    const payment = await this.getById(paymentId);

    const [beneficiary, workflowSteps, decisions, submitters] = await Promise.all([
      this.counterpartiesRepository.findById(payment.beneficiary_counterparty_id),
      payment.approval_workflow_id
        ? this.approvalsRepository.listWorkflowSteps(payment.approval_workflow_id)
        : Promise.resolve([]),
      this.approvalsRepository.listPaymentDecisions([payment.id]),
      this.approvalsRepository.getUsersByIds([payment.created_by])
    ]);

    const roleNames = await this.approvalsRepository.getRolesByIds(workflowSteps.map((step) => step.role_id));
    const approverUsers = await this.approvalsRepository.getUsersByIds(
      Array.from(new Set(decisions.map((decision) => decision.approver_user_id)))
    );
    const currentStep = getCurrentApprovalStep(workflowSteps, decisions);

    const approvalSteps: PaymentApprovalStepDetail[] = workflowSteps.map((step) => {
      const stepDecisions = decisions.filter((decision) => decision.approval_step_id === step.id);
      const approvalsReceived = stepDecisions.filter((decision) => decision.decision === 'approved').length;
      const rejectedDecision = stepDecisions.find((decision) => decision.decision === 'rejected');

      let status: PaymentApprovalStepDetail['status'] = 'pending';
      if (rejectedDecision) {
        status = 'rejected';
      } else if (approvalsReceived >= step.min_approvals) {
        status = 'completed';
      } else if (currentStep?.id === step.id) {
        status = 'current';
      }

      return {
        id: step.id,
        roleId: step.role_id,
        roleName: roleNames.get(step.role_id) ?? 'Unknown role',
        stepOrder: step.step_order,
        minApprovals: step.min_approvals,
        approvalsReceived,
        status,
        decisions: stepDecisions.map((decision) => {
          const approver = approverUsers.get(decision.approver_user_id);
          return {
            approvalStepId: decision.approval_step_id,
            approverUserId: decision.approver_user_id,
            decision: decision.decision,
            comment: decision.comment,
            decidedAt: decision.decided_at,
            approver: approver
              ? {
                  id: approver.id,
                  displayName: approver.display_name,
                  email: approver.email
                }
              : null
          };
        })
      };
    });

    const approvalChain: PaymentApprovalChainDetail = {
      workflowId: payment.approval_workflow_id,
      currentStepId: currentStep?.id ?? null,
      alreadyApprovedByCurrentUser: decisions.some(
        (decision) => decision.approver_user_id === viewerUserId && decision.decision === 'approved'
      ),
      steps: approvalSteps
    };

    const submitter = submitters.get(payment.created_by);

    return {
      ...payment,
      beneficiary: beneficiary
        ? {
            id: beneficiary.id,
            name: beneficiary.name,
            type: beneficiary.type,
            countryCode: beneficiary.country_code,
            riskRating: beneficiary.risk_rating
          }
        : null,
      submitter: submitter
        ? {
            id: submitter.id,
            displayName: submitter.display_name,
            email: submitter.email
          }
        : null,
      approval_chain: approvalChain
    };
  }

  async cancel(paymentId: string) {
    const payment = await this.getById(paymentId);

    if (payment.status === 'sent' || payment.status === 'settled') {
      throw new PaymentExecutionError('Executed payments cannot be cancelled');
    }

    if (payment.status === 'cancelled') {
      return payment;
    }

    return withTransactionBoundary('payments.cancel', async () => {
      const updated = await this.paymentsRepository.updateStatus(paymentId, 'cancelled', payment.version);
      if (!updated) {
        throw new ConflictError('Payment state changed while cancelling');
      }
      return updated;
    });
  }

  async retry(paymentId: string, idempotencyKey: string) {
    const payment = await this.getById(paymentId);

    if (payment.status !== 'failed') {
      throw new ConflictError('Only failed payments can be retried');
    }

    const requestHash = sha256(JSON.stringify({ paymentId }));
    const existingIdempotency = await this.idempotencyRepository.find('payments.retry', idempotencyKey);

    if (existingIdempotency) {
      if (existingIdempotency.request_hash !== requestHash) {
        throw new ConflictError('Idempotency key was already used with a different payment retry request');
      }

      if (existingIdempotency.status === 'completed' && existingIdempotency.response_snapshot) {
        return existingIdempotency.response_snapshot;
      }

      if (existingIdempotency.status === 'in_progress') {
        const latestPayment = await this.getById(paymentId);
        if (latestPayment.status !== 'failed') {
          await this.idempotencyRepository.markCompleted(
            'payments.retry',
            idempotencyKey,
            latestPayment as unknown as Record<string, unknown>
          );
          return latestPayment;
        }

        throw new ConflictError('Payment retry is already being processed');
      }
    }

    return withTransactionBoundary('payments.retry', async () => {
      await this.idempotencyRepository.createInProgress('payments.retry', idempotencyKey, requestHash);

      try {
        const updated = await this.paymentsRepository.updateStatus(paymentId, 'pending_approval', payment.version);
        if (!updated) {
          throw new ConflictError('Payment state changed while retrying');
        }

        await this.idempotencyRepository.markCompleted(
          'payments.retry',
          idempotencyKey,
          updated as unknown as Record<string, unknown>
        );
        return updated;
      } catch (error) {
        await this.idempotencyRepository.markFailed(
          'payments.retry',
          idempotencyKey,
          error instanceof Error ? error.message : 'Unknown payment retry failure'
        );
        throw error;
      }
    });
  }
}

function buildPolicyNotes(warnings: PolicyWarning[]): string | null {
  if (warnings.length === 0) {
    return null;
  }

  return ['Policy evaluation notes:', ...warnings.map((warning) => `- [${warning.action}] ${warning.message}`)].join('\n');
}
