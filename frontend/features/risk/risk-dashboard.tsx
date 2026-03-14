'use client';

import { useDeferredValue, useMemo, useState, useTransition } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, RefreshCw, ShieldAlert, ShieldCheck, Siren, Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { useAcknowledgeAlertMutation, useRecalculateRiskMutation, useResolveAlertMutation, useRiskAlertsQuery, useRiskExposuresQuery } from '@/hooks/use-treasury-queries';
import { ModuleShell } from '@/features/treasury/module-shell';
import type { RiskAlert, RiskAlertStatus, RiskExposureMatrixRow } from '@/lib/types';
import { formatCurrency, formatPercent } from '@/lib/format';

const stressScenarioOptions = [
  {
    value: 'combined_squeeze',
    label: 'Combined squeeze',
    note: '-20% inflows and +20% outflows'
  }
] as const;

const alertFilters: Array<{ value: 'all' | RiskAlertStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' }
];

function formatStatusLabel(status: RiskExposureMatrixRow['status']) {
  if (status === 'breached') {
    return 'Breached';
  }
  if (status === 'warning') {
    return 'Warning';
  }
  return 'Normal';
}

function statusBadgeVariant(status: RiskExposureMatrixRow['status']) {
  if (status === 'breached') {
    return 'danger' as const;
  }
  if (status === 'warning') {
    return 'warning' as const;
  }
  return 'success' as const;
}

function severityBadgeVariant(severity: RiskAlert['severity']) {
  if (severity === 'critical') {
    return 'danger' as const;
  }
  if (severity === 'warning') {
    return 'warning' as const;
  }
  return 'secondary' as const;
}

function severityIcon(severity: RiskAlert['severity']) {
  if (severity === 'critical') {
    return '🔴';
  }
  if (severity === 'warning') {
    return '🟡';
  }
  return '🔵';
}

function formatLastCalculated(lastCalculatedAt: string | null) {
  if (!lastCalculatedAt) {
    return 'Awaiting first risk calculation';
  }

  const diffMs = Date.now() - new Date(lastCalculatedAt).getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));
  if (diffMinutes < 1) {
    return 'Last calculated just now';
  }
  if (diffMinutes < 60) {
    return `Last calculated ${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  return `Last calculated ${diffHours} hr ago`;
}

function alertBannerTone(breached: number, warning: number) {
  if (breached > 0) {
    return 'border-rose-200 bg-rose-50/80 text-rose-900';
  }
  if (warning > 0) {
    return 'border-amber-200 bg-amber-50/80 text-amber-900';
  }
  return 'border-emerald-200 bg-emerald-50/80 text-emerald-900';
}

function RiskDashboardSkeleton() {
  return (
    <ModuleShell
      eyebrow="Risk exposure"
      title="Treasury risk monitoring tied directly to policy thresholds."
      description="Keep translation, counterparty, and short-term funding exposures inside control bands with live alerting and stress visibility."
      metrics={[
        { label: 'Exposures monitored', value: '...', detail: 'Loading latest risk posture' },
        { label: 'Within policy', value: '...', detail: 'Loading' },
        { label: 'Warnings', value: '...', detail: 'Loading' },
        { label: 'Breaches', value: '...', detail: 'Loading' }
      ]}
    >
      <div className="space-y-6">
        <Skeleton className="h-24 w-full rounded-[28px]" />
        <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <Skeleton className="h-[460px] w-full rounded-[28px]" />
          <Skeleton className="h-[460px] w-full rounded-[28px]" />
        </div>
        <Skeleton className="h-[380px] w-full rounded-[28px]" />
      </div>
    </ModuleShell>
  );
}

export function RiskDashboard() {
  const exposuresQuery = useRiskExposuresQuery();
  const [alertFilter, setAlertFilter] = useState<'all' | RiskAlertStatus>('all');
  const [selectedScenario, setSelectedScenario] = useState<(typeof stressScenarioOptions)[number]['value']>('combined_squeeze');
  const [notesByAlertId, setNotesByAlertId] = useState<Record<string, string>>({});
  const [isFilterPending, startFilterTransition] = useTransition();
  const deferredAlertFilter = useDeferredValue(alertFilter);

  const alertsQuery = useRiskAlertsQuery(
    deferredAlertFilter === 'all'
      ? {}
      : {
          status: deferredAlertFilter
        }
  );
  const acknowledgeAlertMutation = useAcknowledgeAlertMutation();
  const resolveAlertMutation = useResolveAlertMutation();
  const recalculateRiskMutation = useRecalculateRiskMutation();

  const snapshot = exposuresQuery.data;
  const alerts = alertsQuery.data ?? [];

  const matrixRows = useMemo(() => snapshot?.matrix ?? [], [snapshot?.matrix]);
  const liquidity = snapshot?.liquidity ?? null;
  const chartData = useMemo(
    () =>
      liquidity
        ? [
            {
              label: 'Current',
              value: Number(liquidity.currentCashBuffer),
              fill: '#0f766e'
            },
            {
              label: 'Base floor',
              value: Number(liquidity.baselineMinimumCashBuffer),
              fill: '#1f2937'
            },
            {
              label: 'Stress floor',
              value: Number(liquidity.stressedMinimumCashBuffer),
              fill: '#c2410c'
            }
          ]
        : [],
    [liquidity]
  );

  if (exposuresQuery.isLoading && !snapshot) {
    return <RiskDashboardSkeleton />;
  }

  if (exposuresQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Risk data unavailable</CardTitle>
          <CardDescription>
            {exposuresQuery.error instanceof Error ? exposuresQuery.error.message : 'Unable to load risk exposures.'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const summary = snapshot?.summary ?? { breached: 0, warning: 0, normal: 0 };

  return (
    <ModuleShell
      eyebrow="Risk exposure"
      title="Treasury risk monitoring tied directly to policy thresholds."
      description="Keep translation, counterparty, and short-term funding exposures inside control bands with live alerting and stress visibility."
      primaryAction={
        <Button
          type="button"
          onClick={() => recalculateRiskMutation.mutate({})}
          disabled={recalculateRiskMutation.isPending}
        >
          <RefreshCw className={`h-4 w-4 ${recalculateRiskMutation.isPending ? 'animate-spin' : ''}`} />
          {recalculateRiskMutation.isPending ? 'Queuing recalculation' : 'Recalculate'}
        </Button>
      }
      secondaryAction={<span className="text-sm text-slate-500">{formatLastCalculated(snapshot?.lastCalculatedAt ?? null)}</span>}
      metrics={[
        {
          label: 'Exposures monitored',
          value: String(matrixRows.length),
          detail: `As of ${snapshot?.valuationDate ?? 'unavailable'}`
        },
        {
          label: 'Within policy',
          value: String(summary.normal),
          detail: 'Healthy control posture'
        },
        {
          label: 'Warnings',
          value: String(summary.warning),
          detail: 'Threshold watch state'
        },
        {
          label: 'Breaches',
          value: String(summary.breached),
          detail: 'Immediate action required'
        }
      ]}
    >
      <div className="space-y-6">
        <section
          className={`rounded-[28px] border px-6 py-5 shadow-sm ${alertBannerTone(summary.breached, summary.warning)}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="eyebrow">Alert banner</p>
              <div className="flex items-center gap-3">
                {summary.breached > 0 ? <Siren className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                <p className="text-lg font-semibold">
                  {summary.breached} breaches, {summary.warning} warnings
                </p>
              </div>
            </div>
            <p className="max-w-xl text-sm leading-6">
              {summary.breached > 0
                ? 'Policy breaches are open and require acknowledgement or resolution with audit notes.'
                : summary.warning > 0
                  ? 'No active breaches, but threshold utilization is elevated and should be monitored closely.'
                  : 'All monitored exposures are currently within policy tolerance.'}
            </p>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardDescription>Exposure matrix</CardDescription>
              <CardTitle>Exposure, limits, and coverage by risk type</CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Risk Type</TableHead>
                    <TableHead>Exposure Amount</TableHead>
                    <TableHead>Limit</TableHead>
                    <TableHead>Coverage %</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrixRows.map((row) => (
                    <TableRow key={`${row.riskType}-${row.title}`}>
                      <TableCell>
                        <div>
                          <p className="font-semibold text-slate-900">{row.title}</p>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{row.riskType.replace('_', ' ')}</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(row.exposureAmount, snapshot?.baseCurrency ?? 'USD')}
                      </TableCell>
                      <TableCell>
                        {row.limitAmount ? formatCurrency(row.limitAmount, snapshot?.baseCurrency ?? 'USD') : 'N/A'}
                      </TableCell>
                      <TableCell>{row.coverageRatio ? formatPercent(Number(row.coverageRatio)) : 'N/A'}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(row.status)}>{formatStatusLabel(row.status)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {matrixRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-12 text-center text-sm text-slate-500">
                        No calculated exposures are available yet. Queue a recalculation to populate the matrix.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_top_left,rgba(15,118,110,0.18),transparent_55%),radial-gradient(circle_at_top_right,rgba(194,65,12,0.14),transparent_40%)]" />
            <CardHeader className="relative">
              <CardDescription>Stress test</CardDescription>
              <CardTitle>Liquidity stress buffer</CardTitle>
            </CardHeader>
            <CardContent className="relative space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={selectedScenario}
                  onChange={(event) => setSelectedScenario(event.target.value as (typeof stressScenarioOptions)[number]['value'])}
                >
                  {stressScenarioOptions.map((scenario) => (
                    <option key={scenario.value} value={scenario.value}>
                      {scenario.label}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => recalculateRiskMutation.mutate({})}
                  disabled={recalculateRiskMutation.isPending}
                >
                  <Waves className="h-4 w-4" />
                  Run Stress Test
                </Button>
              </div>
              <p className="text-sm text-slate-500">
                {stressScenarioOptions.find((scenario) => scenario.value === selectedScenario)?.note}
              </p>
              <div className="h-[260px] rounded-[24px] border border-slate-200/80 bg-white/70 p-4">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 8" vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                      <YAxis
                        tickFormatter={(value) => formatCurrency(value, snapshot?.baseCurrency ?? 'USD')}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#64748b', fontSize: 12 }}
                        width={92}
                      />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value, snapshot?.baseCurrency ?? 'USD')}
                        contentStyle={{
                          borderRadius: 18,
                          border: '1px solid rgba(226,232,240,1)',
                          background: 'rgba(255,255,255,0.96)'
                        }}
                      />
                      <Bar dataKey="value" radius={[12, 12, 4, 4]} fill="#0f766e" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No liquidity stress result is available yet.
                  </div>
                )}
              </div>
              {liquidity ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">Current cash buffer</p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatCurrency(liquidity.currentCashBuffer, liquidity.baseCurrency)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">Stressed minimum buffer</p>
                    <p className="mt-1 text-lg font-semibold">
                      {formatCurrency(liquidity.stressedMinimumCashBuffer, liquidity.baseCurrency)}
                    </p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <CardDescription>Risk alerts</CardDescription>
              <CardTitle>Exception queue with audit notes</CardTitle>
            </div>
            <div className="flex flex-wrap gap-2">
              {alertFilters.map((filter) => (
                <Button
                  key={filter.value}
                  type="button"
                  size="sm"
                  variant={alertFilter === filter.value ? 'default' : 'outline'}
                  disabled={isFilterPending}
                  onClick={() => startFilterTransition(() => setAlertFilter(filter.value))}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {alertsQuery.isLoading && alerts.length === 0 ? (
              <>
                <Skeleton className="h-28 w-full rounded-[24px]" />
                <Skeleton className="h-28 w-full rounded-[24px]" />
              </>
            ) : null}
            {alerts.map((alert) => {
              const note = notesByAlertId[alert.id] ?? '';
              return (
                <div key={alert.id} className="rounded-[24px] border border-slate-200/80 bg-white/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-lg" aria-hidden="true">
                          {severityIcon(alert.severity)}
                        </span>
                        <p className="font-semibold text-slate-950">{alert.title}</p>
                        <Badge variant={severityBadgeVariant(alert.severity)}>{alert.severity}</Badge>
                      </div>
                      <p className="text-sm leading-6 text-slate-600">{alert.message}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-400">
                        <span>{alert.risk_type.replace('_', ' ')}</span>
                        <span>{new Date(alert.created_at).toLocaleString('en-US')}</span>
                        <span>{alert.status}</span>
                      </div>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {alert.related_entity_type ?? 'risk alert'}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
                    <Input
                      value={note}
                      placeholder="Required note for acknowledge or resolve"
                      onChange={(event) =>
                        setNotesByAlertId((current) => ({
                          ...current,
                          [alert.id]: event.target.value
                        }))
                      }
                      disabled={alert.status === 'resolved'}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={alert.status !== 'open' || !note.trim() || acknowledgeAlertMutation.isPending}
                      onClick={() => acknowledgeAlertMutation.mutate({ alertId: alert.id, note: note.trim() })}
                    >
                      <ShieldAlert className="h-4 w-4" />
                      Acknowledge
                    </Button>
                    <Button
                      type="button"
                      variant="success"
                      disabled={alert.status === 'resolved' || !note.trim() || resolveAlertMutation.isPending}
                      onClick={() => resolveAlertMutation.mutate({ alertId: alert.id, note: note.trim() })}
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Resolve
                    </Button>
                  </div>
                  {alert.resolution_note ? (
                    <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <span className="font-semibold text-slate-900">Latest note:</span> {alert.resolution_note}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!alertsQuery.isLoading && alerts.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
                No alerts match the current filter.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </ModuleShell>
  );
}
