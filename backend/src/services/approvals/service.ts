import { ConflictError } from '@/errors/ConflictError';
import { AuthorizationError } from '@/errors/AuthorizationError';
import { NotFoundError } from '@/errors/NotFoundError';
import { withTransactionBoundary } from '@/lib/transaction';
import {
  ApprovalsRepository,
  type ApprovalStep,
  type PaymentDecision
} from '@/repositories/approvals/repository';
import { PaymentsRepository } from '@/repositories/payments/repository';
import { NotificationsService } from '@/services/notifications/service';
import type { ApprovalDecisionInput } from '@/types/approvals/types';
import type { PendingApprovalItem } from '@/types/approvals/types';
import type { ServiceContext } from '@/services/context';

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

export class ApprovalsService {
  private readonly approvalsRepository: ApprovalsRepository;
  private readonly paymentsRepository: PaymentsRepository;
  private readonly notificationsService: NotificationsService;

  constructor(
    context: ServiceContext,
    approvalsRepository?: ApprovalsRepository,
    paymentsRepository?: PaymentsRepository,
    notificationsService?: NotificationsService
  ) {
    this.approvalsRepository = approvalsRepository ?? new ApprovalsRepository({ organizationId: context.organizationId });
    this.paymentsRepository = paymentsRepository ?? new PaymentsRepository({ organizationId: context.organizationId });
    this.notificationsService = notificationsService ?? new NotificationsService(context);
  }

  async listPending(userId: string) {
    const userRoleId = await this.approvalsRepository.getUserRoleId(userId);
    if (!userRoleId) {
      return [];
    }

    const pendingPayments = await this.approvalsRepository.listPendingPayments();
    const decisions = await this.approvalsRepository.listPaymentDecisions(pendingPayments.map((payment) => payment.id));
    const workflowIds = Array.from(new Set(pendingPayments.map((payment) => payment.approvalWorkflowId).filter(Boolean)));
    const workflowStepsEntries = await Promise.all(
      workflowIds.map(async (workflowId) => [workflowId, await this.approvalsRepository.listWorkflowSteps(workflowId)] as const)
    );
    const workflowStepsById = new Map(workflowStepsEntries);

    return pendingPayments
      .filter((payment) => payment.approvalWorkflowId)
      .map((payment) => {
        const workflowSteps = workflowStepsById.get(payment.approvalWorkflowId) ?? [];
        const paymentDecisions = decisions.filter((decision) => decision.payment_id === payment.id);
        const currentStep = getCurrentApprovalStep(workflowSteps, paymentDecisions);

        if (!currentStep || currentStep.role_id !== userRoleId) {
          return null;
        }

        const userAlreadyDecided = paymentDecisions.some(
          (decision) => decision.approval_step_id === currentStep.id && decision.approver_user_id === userId
        );

        if (userAlreadyDecided) {
          return null;
        }

        return {
          paymentId: payment.id,
          paymentReference: payment.paymentReference,
          amount: payment.amount,
          currencyCode: payment.currencyCode,
          valueDate: payment.valueDate,
          createdAt: payment.createdAt,
          rowVersionToken: payment.rowVersionToken
        };
      })
      .filter((payment): payment is PendingApprovalItem => payment !== null);
  }

  async approve(input: ApprovalDecisionInput, approverUserId: string) {
    const payment = await this.paymentsRepository.findById(input.paymentId);
    if (!payment) {
      throw new NotFoundError('Payment not found');
    }

    if (payment.status !== 'pending_approval') {
      throw new ConflictError('Stale approval request: payment is not pending approval');
    }

    if (String(payment.version) !== input.rowVersionToken) {
      throw new ConflictError('Stale approval request: row version mismatch');
    }

    if (!payment.approval_workflow_id) {
      throw new ConflictError('Payment approval workflow is missing');
    }

    const approverRoleId = await this.approvalsRepository.getUserRoleId(approverUserId);
    if (!approverRoleId) {
      throw new AuthorizationError('Approver does not have an active role in this organization');
    }

    const workflowSteps = await this.approvalsRepository.listWorkflowSteps(payment.approval_workflow_id);
    const decisions = await this.approvalsRepository.listPaymentDecisions([payment.id]);
    const currentStep = getCurrentApprovalStep(workflowSteps, decisions);

    if (!currentStep || currentStep.role_id !== approverRoleId) {
      throw new AuthorizationError('Approver is not authorized for the current approval step');
    }

    if (decisions.some((decision) => decision.approval_step_id === currentStep.id && decision.approver_user_id === approverUserId)) {
      throw new ConflictError('Approver has already recorded a decision for this step');
    }

    return withTransactionBoundary('payments.approve', async () => {
      await this.approvalsRepository.saveDecision({
        paymentId: input.paymentId,
        approvalStepId: currentStep.id,
        approverUserId,
        decision: 'approved',
        comment: input.comment
      });

      const approvalsOnCurrentStep =
        decisions.filter((decision) => decision.approval_step_id === currentStep.id && decision.decision === 'approved').length + 1;
      const currentStepIndex = workflowSteps.findIndex((step) => step.id === currentStep.id);
      const shouldAdvanceToApproved =
        approvalsOnCurrentStep >= currentStep.min_approvals && currentStepIndex === workflowSteps.length - 1;

      const updated = await this.paymentsRepository.updateStatus(
        input.paymentId,
        shouldAdvanceToApproved ? 'approved' : 'pending_approval',
        payment.version
      );
      if (!updated) {
        throw new ConflictError('Payment state changed during approval');
      }

      if (shouldAdvanceToApproved) {
        await this.notificationsService.paymentApproved(updated, payment.created_by);
      } else if (approvalsOnCurrentStep >= currentStep.min_approvals) {
        const nextStep = workflowSteps[currentStepIndex + 1];
        if (nextStep) {
          const nextApprovers = await this.approvalsRepository.listActiveUserIdsByRole(nextStep.role_id);
          await Promise.all(
            nextApprovers.map((userId) => this.notificationsService.paymentApprovalRequired(updated, userId))
          );
        }
      }

      return updated;
    });
  }

  async reject(input: ApprovalDecisionInput, approverUserId: string) {
    const payment = await this.paymentsRepository.findById(input.paymentId);
    if (!payment) {
      throw new NotFoundError('Payment not found');
    }

    if (payment.status !== 'pending_approval') {
      throw new ConflictError('Stale approval request: payment is not pending approval');
    }

    if (String(payment.version) !== input.rowVersionToken) {
      throw new ConflictError('Stale approval request: row version mismatch');
    }

    if (!payment.approval_workflow_id) {
      throw new ConflictError('Payment approval workflow is missing');
    }

    const approverRoleId = await this.approvalsRepository.getUserRoleId(approverUserId);
    if (!approverRoleId) {
      throw new AuthorizationError('Approver does not have an active role in this organization');
    }

    const workflowSteps = await this.approvalsRepository.listWorkflowSteps(payment.approval_workflow_id);
    const decisions = await this.approvalsRepository.listPaymentDecisions([payment.id]);
    const currentStep = getCurrentApprovalStep(workflowSteps, decisions);

    if (!currentStep || currentStep.role_id !== approverRoleId) {
      throw new AuthorizationError('Approver is not authorized for the current approval step');
    }

    return withTransactionBoundary('payments.reject', async () => {
      await this.approvalsRepository.saveDecision({
        paymentId: input.paymentId,
        approvalStepId: currentStep.id,
        approverUserId,
        decision: 'rejected',
        comment: input.comment
      });

      const updated = await this.paymentsRepository.updateStatus(input.paymentId, 'rejected', payment.version);
      if (!updated) {
        throw new ConflictError('Payment state changed during rejection');
      }

      await this.notificationsService.paymentRejected(updated, payment.created_by, input.comment ?? '');

      return updated;
    });
  }
}
