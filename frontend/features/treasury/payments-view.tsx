'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { PaymentTable } from '@/components/tables/payment-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Skeleton } from '@/components/ui/skeleton';
import { SlideOver } from '@/components/ui/slide-over';
import { PaymentApprovalPanel } from '@/features/payments/payment-approval-panel';
import { PaymentForm } from '@/features/payments/payment-form';
import { ModuleShell } from '@/features/treasury/module-shell';
import {
  useCounterpartiesQuery,
  useCurrentProfileQuery,
  usePaymentsQuery
} from '@/hooks/use-treasury-queries';
import { formatCurrency, formatRelativeLabel } from '@/lib/format';
import type { Payment, PaymentVolumePoint } from '@/lib/types';

const PaymentVolumeChart = dynamic(
  () => import('@/components/charts/payment-volume-chart').then((module) => module.PaymentVolumeChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[280px] w-full rounded-2xl" />
  }
);

const statusTabs = [
  { label: 'All', value: 'all' },
  { label: 'Pending Approval', value: 'pending_approval' },
  { label: 'Approved', value: 'approved' },
  { label: 'Settled', value: 'settled' },
  { label: 'Failed', value: 'failed' }
] as const;

type PaymentStatusFilter = (typeof statusTabs)[number]['value'];

export function PaymentsView() {
  const [status, setStatus] = useState<PaymentStatusFilter>('all');
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [approvalPaymentId, setApprovalPaymentId] = useState<string | null>(null);

  const paymentsQuery = usePaymentsQuery({
    status: status === 'all' ? undefined : status
  });
  const counterpartiesQuery = useCounterpartiesQuery({ limit: 100 });
  const profileQuery = useCurrentProfileQuery();

  const payments = paymentsQuery.data?.items ?? [];
  const counterparties = counterpartiesQuery.data?.items ?? [];
  const counterpartyNamesById = useMemo(
    () => Object.fromEntries(counterparties.map((counterparty) => [counterparty.id, counterparty.name])),
    [counterparties]
  );

  const hasApprovalPermission = useMemo(
    () => Object.values(profileQuery.data?.permissions ?? {}).some((permissions) => permissions.includes('payments.approve')),
    [profileQuery.data?.permissions]
  );

  const metrics = useMemo(
    () => [
      {
        label: 'Payments in view',
        value: String(payments.length),
        detail: 'Live instructions after the active status filter.'
      },
      {
        label: 'Awaiting approval',
        value: String(payments.filter((payment) => payment.status === 'pending_approval').length),
        detail: 'Instructions blocked on treasury authorization.'
      },
      {
        label: 'Ready to send',
        value: String(payments.filter((payment) => payment.status === 'approved').length),
        detail: 'Approved instructions pending bank connector release.'
      },
      {
        label: 'Value at risk',
        value: formatCurrency(
          payments
            .filter((payment) => payment.status === 'pending_approval')
            .reduce((sum, payment) => sum + Number(payment.amount), 0)
        ),
        detail: 'Pending approval value exposed to processing delay.'
      }
    ],
    [payments]
  );

  const chartData = useMemo<PaymentVolumePoint[]>(() => buildPaymentVolumeData(payments), [payments]);
  const pendingApprovals = useMemo(
    () => payments.filter((payment) => payment.status === 'pending_approval').slice(0, 3),
    [payments]
  );

  return (
    <>
      <ModuleShell
        eyebrow="Payments"
        title="High-control payment workflows with approval visibility."
        description="Initiate payment instructions, monitor balance coverage, and execute approval decisions from the operating queue."
        primaryAction={
          <Button type="button" onClick={() => setPaymentFormOpen(true)}>
            Initiate Payment
          </Button>
        }
        secondaryAction={
          hasApprovalPermission ? (
            <Button type="button" variant="outline" onClick={() => setStatus('pending_approval')}>
              Pending Approval
            </Button>
          ) : undefined
        }
        metrics={metrics}
      >
        <div className="flex flex-wrap gap-3">
          {statusTabs.map((tab) => (
            <Button
              key={tab.value}
              type="button"
              variant={status === tab.value ? 'default' : 'outline'}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <PaymentTable
            payments={payments}
            counterpartyNamesById={counterpartyNamesById}
            renderActions={
              hasApprovalPermission
                ? (payment) =>
                    payment.status === 'pending_approval' ? (
                      <Button type="button" size="sm" onClick={() => setApprovalPaymentId(payment.id)}>
                        Review &amp; Approve
                      </Button>
                    ) : null
                : undefined
            }
          />
          <div className="space-y-6">
            <Card>
              <CardHeader className="border-b border-slate-100 pb-4">
                <CardDescription>Volume analytics</CardDescription>
                <CardTitle>Queue mix by value date</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <PaymentVolumeChart data={chartData} title="Payment volume by value date and approval urgency" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Pending approvals</CardDescription>
                <CardTitle>Highest priority queue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {pendingApprovals.length > 0 ? (
                  pendingApprovals.map((payment) => (
                    <PendingApprovalCard
                      key={payment.id}
                      payment={payment}
                      counterpartyName={counterpartyNamesById[payment.beneficiary_counterparty_id]}
                      onReview={hasApprovalPermission ? () => setApprovalPaymentId(payment.id) : undefined}
                    />
                  ))
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                    No pending approvals are currently in the queue.
                  </p>
                )}
                {paymentsQuery.error ? (
                  <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    Live payment data could not be refreshed. Verify your session token and API availability.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </ModuleShell>
      <SlideOver
        open={paymentFormOpen}
        onClose={() => setPaymentFormOpen(false)}
        title="Initiate payment"
        description="Create a new payment instruction with deterministic validation, balance coverage checks, and idempotent submission."
      >
        <ErrorBoundary title="Payment initiation failed to render">
          <PaymentForm onCancel={() => setPaymentFormOpen(false)} />
        </ErrorBoundary>
      </SlideOver>
      <SlideOver
        open={Boolean(approvalPaymentId)}
        onClose={() => setApprovalPaymentId(null)}
        title="Review & approve"
        description="Inspect the payment instruction, review the approval chain, and record an approval or rejection."
      >
        <ErrorBoundary title="Approval panel failed to render">
          {approvalPaymentId ? <PaymentApprovalPanel paymentId={approvalPaymentId} /> : null}
        </ErrorBoundary>
      </SlideOver>
    </>
  );
}

function PendingApprovalCard({
  payment,
  counterpartyName,
  onReview
}: {
  payment: Payment;
  counterpartyName?: string;
  onReview?: () => void;
}) {
  const dueInDays = getDaysUntil(payment.value_date);

  return (
    <div className="rounded-2xl border border-slate-100 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{counterpartyName ?? payment.payment_reference}</p>
          <p className="text-sm text-slate-500">{payment.purpose ?? payment.payment_reference}</p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
          Pending
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-lg font-semibold">{formatCurrency(payment.amount, payment.currency_code)}</p>
          <p className="text-sm text-slate-500">{formatRelativeLabel(dueInDays)}</p>
        </div>
        {onReview ? (
          <Button type="button" size="sm" onClick={onReview}>
            Review &amp; Approve
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function buildPaymentVolumeData(payments: Payment[]) {
  const grouped = new Map<string, PaymentVolumePoint & { sortKey: number }>();

  for (const payment of payments) {
    const date = new Date(`${payment.value_date}T00:00:00`);
    const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
    const current = grouped.get(label) ?? {
      label,
      urgent: 0,
      scheduled: 0,
      sortKey: date.getTime()
    };

    if (payment.status === 'pending_approval' || payment.status === 'failed') {
      current.urgent += 1;
    } else {
      current.scheduled += 1;
    }

    grouped.set(label, current);
  }

  return Array.from(grouped.values())
    .sort((left, right) => left.sortKey - right.sortKey)
    .slice(0, 6)
    .map(({ sortKey: _sortKey, ...point }) => point);
}

function getDaysUntil(valueDate: string) {
  const now = new Date();
  const target = new Date(`${valueDate}T00:00:00`);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}
