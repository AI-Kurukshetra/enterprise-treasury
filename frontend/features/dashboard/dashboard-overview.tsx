'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { CashTrendChart } from '@/components/charts/cash-trend-chart';
import { LiquidityAnalyticsChart } from '@/components/charts/liquidity-analytics-chart';
import { PaymentVolumeChart } from '@/components/charts/payment-volume-chart';
import { PageHeader } from '@/components/layout/page-header';
import {
  useCashPositionQuery,
  useCashTrendQuery,
  useCounterpartiesQuery,
  usePaymentsQuery
} from '@/hooks/use-treasury-queries';
import { formatCurrency, formatDate, formatElapsedTime, formatRelativeLabel } from '@/lib/format';

export function DashboardOverview() {
  const [clockTick, setClockTick] = useState(0);
  const summaryQuery = useCashPositionQuery();
  const trendQuery = useCashTrendQuery(7);
  const paymentsQuery = usePaymentsQuery({ limit: 25 });
  const counterpartiesQuery = useCounterpartiesQuery({ limit: 100 });

  useEffect(() => {
    setClockTick(Date.now());
    const interval = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const summary = summaryQuery.data;
  const trend = trendQuery.data ?? [];
  const payments = paymentsQuery.data?.items ?? [];
  const counterpartiesById = useMemo(
    () =>
      new Map((counterpartiesQuery.data?.items ?? []).map((counterparty) => [counterparty.id, counterparty.name])),
    [counterpartiesQuery.data?.items]
  );

  const pendingApprovals = useMemo(
    () => payments.filter((payment) => payment.status === 'pending_approval').slice(0, 3),
    [payments]
  );
  const upcomingPayments = useMemo(
    () =>
      [...payments]
        .filter((payment) => ['pending_approval', 'approved', 'sent'].includes(payment.status))
        .sort((left, right) => left.value_date.localeCompare(right.value_date))
        .slice(0, 3),
    [payments]
  );

  const lastUpdatedAt = Math.max(summaryQuery.dataUpdatedAt, trendQuery.dataUpdatedAt);
  const hasPositionError = summaryQuery.isError || trendQuery.isError;
  const isMetricLoading = (summaryQuery.isLoading && !summary) || (trendQuery.isLoading && trend.length === 0);

  async function handleRefresh() {
    await Promise.all([
      summaryQuery.refetch(),
      trendQuery.refetch(),
      paymentsQuery.refetch(),
      counterpartiesQuery.refetch()
    ]);
  }

  const metrics = [
    {
      title: 'Global cash position',
      value: summary ? formatCurrency(summary.totalCash, summary.baseCurrency) : '--',
      delta: summary ? `Base ${summary.baseCurrency}` : undefined,
      hint: summary ? `Consolidated balance snapshot as of ${formatDate(summary.asOf)}` : 'Live consolidated cash balance',
      trend: 'neutral' as const
    },
    {
      title: 'Available liquidity',
      value: summary ? formatCurrency(summary.availableLiquidity, summary.baseCurrency) : '--',
      delta: summary ? `${summary.pendingPayments.count} reserved` : undefined,
      hint: 'Current balance minus reserved pending payments',
      trend: 'neutral' as const
    },
    {
      title: 'Pending payments',
      value: summary ? formatCurrency(summary.pendingPayments.amount, summary.baseCurrency) : '--',
      delta: summary ? `${summary.pendingPayments.count} items` : undefined,
      hint: 'Payments currently reserved against account availability',
      trend: 'down' as const
    },
    {
      title: 'Risk limits in watch state',
      value: summary ? String(summary.riskLimitsInWatch) : '--',
      delta: summary && summary.riskLimitsInWatch > 0 ? 'Review required' : 'Within policy',
      hint: 'Liquidity and exposure thresholds requiring treasury review',
      trend: summary && summary.riskLimitsInWatch > 0 ? ('down' as const) : ('neutral' as const)
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Treasury cockpit"
        title="Enterprise liquidity decisions, compressed into one operating surface."
        description="Monitor global cash, release critical payments, and watch policy-sensitive exposures without losing the operational detail finance teams need."
        primaryAction={
          <Button type="button" onClick={handleRefresh} disabled={summaryQuery.isFetching && trendQuery.isFetching}>
            <RefreshCcw className="h-4 w-4" />
            Refresh data
          </Button>
        }
        secondaryAction="Export board view"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Key treasury metrics">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.title}
            title={metric.title}
            value={metric.value}
            delta={metric.delta}
            hint={metric.hint}
            trend={metric.trend}
            loading={isMetricLoading}
            error={hasPositionError}
          />
        ))}
      </section>

      <div className="space-y-2">
        {hasPositionError ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Unable to load position data — last updated {formatElapsedTime(lastUpdatedAt, clockTick || lastUpdatedAt)}
          </p>
        ) : null}
        <p className="text-sm text-slate-500">Last updated: {formatElapsedTime(lastUpdatedAt || clockTick, clockTick || lastUpdatedAt)}</p>
      </div>

      <section className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
        <Card>
          <CardHeader className="border-b border-slate-100 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardDescription>Cash trend</CardDescription>
                <CardTitle>Global cash position and policy buffer</CardTitle>
              </div>
              <div className="text-right">
                <p className="eyebrow">Current level</p>
                <p className="text-2xl font-semibold">
                  {summary ? formatCurrency(summary.totalCash, summary.baseCurrency) : '--'}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <CashTrendChart data={trend} title="Global cash position and policy buffer" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardDescription>Bank balances</CardDescription>
            <CardTitle>Operational concentration by region</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {(summary?.byRegion ?? []).map((region) => (
              <div key={region.region} className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3">
                <div>
                  <p className="font-semibold text-slate-900">{region.region}</p>
                  <p className="text-sm text-slate-500">
                    Operating {formatCurrency(region.operating, summary?.baseCurrency ?? 'USD')} • Reserve{' '}
                    {formatCurrency(region.reserve, summary?.baseCurrency ?? 'USD')}
                  </p>
                </div>
                <p className="text-lg font-semibold">{formatCurrency(region.trapped, summary?.baseCurrency ?? 'USD')}</p>
              </div>
            ))}
            {!summary?.byRegion.length ? (
              <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
                Regional balances will appear after the first live aggregation run completes.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardDescription>Liquidity analytics</CardDescription>
            <CardTitle>Operating, reserve, and trapped cash mix</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <LiquidityAnalyticsChart data={summary?.byRegion ?? []} title="Liquidity mix by region" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardDescription>Pending approvals</CardDescription>
            <CardTitle>High-value release queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {pendingApprovals.map((payment) => (
              <div key={payment.id} className="rounded-2xl border border-slate-100 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">
                      {counterpartiesById.get(payment.beneficiary_counterparty_id) ?? payment.payment_reference}
                    </p>
                    <p className="text-sm text-slate-500">{formatRelativeLabel(getDaysUntil(payment.value_date))}</p>
                  </div>
                  <Badge variant="warning">Pending</Badge>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <p className="text-lg font-semibold">{formatCurrency(payment.amount, payment.currency_code)}</p>
                  <p className="text-sm text-slate-500">{payment.payment_reference}</p>
                </div>
              </div>
            ))}
            {!pendingApprovals.length ? (
              <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
                No pending approvals in the current live queue.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardDescription>Payment volume</CardDescription>
            <CardTitle>Urgent vs scheduled payment traffic</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <PaymentVolumeChart data={summary?.paymentVolume ?? []} title="Payment volume by priority" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardDescription>Upcoming payments</CardDescription>
            <CardTitle>Next release windows</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {upcomingPayments.map((payment) => (
              <div key={payment.id} className="rounded-2xl border border-slate-100 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{payment.payment_reference}</p>
                    <p className="text-sm text-slate-500">
                      {counterpartiesById.get(payment.beneficiary_counterparty_id) ?? 'Counterparty pending sync'}
                    </p>
                  </div>
                  <Badge variant="secondary">{payment.status}</Badge>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <p className="text-base font-semibold">{formatCurrency(payment.amount, payment.currency_code)}</p>
                  <p className="text-sm text-slate-500">{formatDate(payment.value_date)}</p>
                </div>
              </div>
            ))}
            {!upcomingPayments.length ? (
              <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
                No upcoming release windows are currently scheduled.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function getDaysUntil(valueDate: string) {
  const today = new Date();
  const target = new Date(`${valueDate}T00:00:00`);
  const diffMs = target.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round(diffMs / 86_400_000);
}
