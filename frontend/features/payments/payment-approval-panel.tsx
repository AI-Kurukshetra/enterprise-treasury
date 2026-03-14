'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Clock3, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ApiError } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  useApprovePaymentMutation,
  useCurrentProfileQuery,
  usePaymentDetailQuery,
  useRejectPaymentMutation
} from '@/hooks/use-treasury-queries';
import type { PaymentDetail, PaymentApprovalDecision, PaymentApprovalStep } from '@/lib/types';

interface PaymentApprovalPanelProps {
  paymentId: string;
}

type PendingDecision =
  | {
      action: 'approve';
      comment?: string;
    }
  | {
      action: 'reject';
      reason: string;
    }
  | null;

export function PaymentApprovalPanel({ paymentId }: PaymentApprovalPanelProps) {
  const paymentQuery = usePaymentDetailQuery(paymentId);
  const profileQuery = useCurrentProfileQuery();
  const approveMutation = useApprovePaymentMutation(paymentId);
  const rejectMutation = useRejectPaymentMutation(paymentId);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [approveComment, setApproveComment] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [pendingDecision, setPendingDecision] = useState<PendingDecision>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');

  const currentUserId = profileQuery.data?.user.id ?? null;
  const payment = paymentQuery.data ?? null;

  const displayPayment = useMemo(() => {
    if (!payment || !pendingDecision || !currentUserId) {
      return payment;
    }

    return applyOptimisticDecision(payment, currentUserId, pendingDecision);
  }, [currentUserId, payment, pendingDecision]);

  const alreadyApproved = displayPayment?.approval_chain.alreadyApprovedByCurrentUser ?? false;
  const pendingStep =
    displayPayment?.approval_chain.steps.find((step) => step.id === displayPayment.approval_chain.currentStepId) ??
    displayPayment?.approval_chain.steps.find((step) => step.status === 'current') ??
    null;

  async function handleApprove() {
    if (!payment) {
      return;
    }

    setErrorMessage(null);
    setPendingDecision({
      action: 'approve',
      comment: approveComment.trim() || undefined
    });
    setLiveMessage('Approval is being submitted.');

    try {
      await approveMutation.mutateAsync({
        rowVersionToken: String(payment.version),
        comment: approveComment.trim() || undefined
      });
      setPendingDecision(null);
      setApproveDialogOpen(false);
      setApproveComment('');
      setLiveMessage('Payment approved successfully.');
    } catch (error) {
      setPendingDecision(null);
      setErrorMessage(error instanceof ApiError ? error.message : 'Approval failed.');
      setLiveMessage(error instanceof ApiError ? error.message : 'Approval failed.');
    }
  }

  async function handleReject() {
    if (!payment) {
      return;
    }

    setErrorMessage(null);
    setPendingDecision({
      action: 'reject',
      reason: rejectReason.trim()
    });
    setLiveMessage('Rejection is being submitted.');

    try {
      await rejectMutation.mutateAsync({
        rowVersionToken: String(payment.version),
        reason: rejectReason.trim()
      });
      setPendingDecision(null);
      setRejectDialogOpen(false);
      setRejectReason('');
      setLiveMessage('Payment rejected successfully.');
    } catch (error) {
      setPendingDecision(null);
      setErrorMessage(error instanceof ApiError ? error.message : 'Rejection failed.');
      setLiveMessage(error instanceof ApiError ? error.message : 'Rejection failed.');
    }
  }

  if (paymentQuery.isLoading) {
    return <p className="text-sm text-slate-500">Loading payment approval context...</p>;
  }

  if (!displayPayment) {
    return <p className="text-sm text-rose-700">Payment details could not be loaded.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="sr-only" aria-live="polite" role="status">
        {liveMessage}
      </div>
      <Card>
        <CardHeader>
          <CardDescription>Approval review</CardDescription>
          <CardTitle>{displayPayment.payment_reference}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <DetailItem label="Amount" value={formatCurrency(displayPayment.amount, displayPayment.currency_code)} />
          <DetailItem label="Beneficiary" value={displayPayment.beneficiary?.name ?? displayPayment.beneficiary_counterparty_id} />
          <DetailItem label="Purpose" value={displayPayment.purpose ?? 'No purpose supplied'} />
          <DetailItem
            label="Submitter"
            value={displayPayment.submitter?.displayName ?? displayPayment.submitter?.email ?? displayPayment.created_by}
          />
          <DetailItem label="Created at" value={formatDate(displayPayment.created_at)} />
          <DetailItem label="Value date" value={formatDate(displayPayment.value_date)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Approval chain</CardDescription>
          <CardTitle>Workflow progression</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {displayPayment.approval_chain.steps.map((step) => (
            <ApprovalStepCard
              key={step.id}
              step={step}
              isCurrent={step.id === displayPayment.approval_chain.currentStepId}
            />
          ))}
          {alreadyApproved ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              You already approved this payment.
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Decision</CardDescription>
          <CardTitle>Approval controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-700">
            Current step: <span className="font-semibold">{pendingStep?.roleName ?? 'No active approval step'}</span>
          </div>
          <div className="space-y-2">
            <label htmlFor="approveComment" className="text-sm font-medium text-slate-900">
              Approval comment
            </label>
            <textarea
              id="approveComment"
              value={approveComment}
              onChange={(event) => setApproveComment(event.target.value)}
              maxLength={280}
              className="focus-ring min-h-24 w-full rounded-[24px] border border-input bg-white px-4 py-3 text-sm text-foreground shadow-sm"
              placeholder="Optional rationale for approval..."
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="rejectReason" className="text-sm font-medium text-slate-900">
              Rejection reason
            </label>
            <textarea
              id="rejectReason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              maxLength={280}
              className="focus-ring min-h-28 w-full rounded-[24px] border border-input bg-white px-4 py-3 text-sm text-foreground shadow-sm"
              placeholder="Required if rejecting this payment."
              aria-invalid={rejectReason.trim().length > 0 && rejectReason.trim().length < 3}
            />
            <p className="text-xs text-slate-500">{rejectReason.length}/280 characters</p>
          </div>
          {errorMessage ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="danger"
              onClick={() => setRejectDialogOpen(true)}
              disabled={
                displayPayment.status !== 'pending_approval' ||
                alreadyApproved ||
                rejectMutation.isPending ||
                rejectReason.trim().length < 3
              }
            >
              {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
            </Button>
            <Button
              type="button"
              variant="success"
              onClick={() => setApproveDialogOpen(true)}
              disabled={displayPayment.status !== 'pending_approval' || alreadyApproved || approveMutation.isPending}
            >
              {approveMutation.isPending ? 'Approving...' : 'Approve'}
            </Button>
          </div>
        </CardContent>
      </Card>
      <ConfirmationDialog
        open={approveDialogOpen}
        onClose={() => setApproveDialogOpen(false)}
        onConfirm={handleApprove}
        title="Approve payment"
        description="This records your approval for the current workflow step. Continue only if the instruction is policy compliant."
        confirmLabel="Approve payment"
        confirmVariant="success"
        loading={approveMutation.isPending}
      />
      <ConfirmationDialog
        open={rejectDialogOpen}
        onClose={() => setRejectDialogOpen(false)}
        onConfirm={handleReject}
        title="Reject payment"
        description={rejectReason.trim() ? rejectReason.trim() : 'Enter a rejection reason before confirming.'}
        confirmLabel="Reject payment"
        confirmVariant="danger"
        loading={rejectMutation.isPending}
      />
    </div>
  );
}

function ApprovalStepCard({ step, isCurrent }: { step: PaymentApprovalStep; isCurrent: boolean }) {
  const statusIcon =
    step.status === 'completed' ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : step.status === 'rejected' ? (
      <XCircle className="h-4 w-4 text-rose-600" />
    ) : (
      <Clock3 className="h-4 w-4 text-amber-600" />
    );

  const badgeVariant =
    step.status === 'completed' ? 'success' : step.status === 'rejected' ? 'danger' : 'warning';

  return (
    <div className="rounded-[26px] border border-slate-200 bg-white px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {statusIcon}
            <p className="font-semibold text-slate-950">{step.roleName}</p>
            {isCurrent ? <Badge variant="outline">Current</Badge> : null}
          </div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Step {step.stepOrder} · {step.approvalsReceived}/{step.minApprovals} approvals
          </p>
        </div>
        <Badge variant={badgeVariant}>{step.status}</Badge>
      </div>
      <div className="mt-4 space-y-3">
        {step.decisions.length > 0 ? (
          step.decisions.map((decision) => (
            <div key={`${decision.approverUserId}-${decision.decidedAt}`} className="rounded-2xl bg-slate-50 px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">
                  {decision.approver?.displayName ?? decision.approver?.email ?? decision.approverUserId}
                </p>
                <Badge variant={decision.decision === 'approved' ? 'success' : 'danger'}>{decision.decision}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500">{formatDate(decision.decidedAt)}</p>
              {decision.comment ? <p className="mt-2 text-sm text-slate-700">{decision.comment}</p> : null}
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-500">No decisions recorded for this step yet.</p>
        )}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

function applyOptimisticDecision(
  payment: PaymentDetail,
  currentUserId: string,
  pendingDecision: Exclude<PendingDecision, null>
): PaymentDetail {
  const steps = payment.approval_chain.steps.map((step) => ({
    ...step,
    decisions: [...step.decisions]
  }));
  const currentStepIndex = steps.findIndex((step) => step.id === payment.approval_chain.currentStepId);

  if (currentStepIndex === -1) {
    return payment;
  }

  const currentStep = { ...steps[currentStepIndex]! };
  const optimisticDecision: PaymentApprovalDecision = {
    approvalStepId: currentStep.id,
    approverUserId: currentUserId,
    decision: pendingDecision.action === 'approve' ? 'approved' : 'rejected',
    comment: pendingDecision.action === 'approve' ? pendingDecision.comment ?? null : pendingDecision.reason,
    decidedAt: new Date().toISOString(),
    approver: {
      id: currentUserId,
      displayName: 'You'
    }
  };

  currentStep.decisions = [...currentStep.decisions, optimisticDecision];
  steps[currentStepIndex] = currentStep;

  if (pendingDecision.action === 'reject') {
    currentStep.status = 'rejected';
    return {
      ...payment,
      status: 'rejected',
      approval_chain: {
        ...payment.approval_chain,
        currentStepId: null,
        alreadyApprovedByCurrentUser: false,
        steps
      }
    };
  }

  currentStep.approvalsReceived += 1;
  currentStep.status = currentStep.approvalsReceived >= currentStep.minApprovals ? 'completed' : 'current';

  const nextStep = steps[currentStepIndex + 1];
  if (currentStep.approvalsReceived >= currentStep.minApprovals && nextStep) {
    nextStep.status = 'current';
  }

  return {
    ...payment,
    status: currentStep.approvalsReceived >= currentStep.minApprovals && !nextStep ? 'approved' : payment.status,
    approval_chain: {
      ...payment.approval_chain,
      currentStepId: currentStep.approvalsReceived >= currentStep.minApprovals ? nextStep?.id ?? null : currentStep.id,
      alreadyApprovedByCurrentUser: true,
      steps
    }
  };
}
