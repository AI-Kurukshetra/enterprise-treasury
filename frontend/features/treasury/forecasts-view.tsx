'use client';

import dynamic from 'next/dynamic';
import { useDeferredValue, useEffect, useState, useTransition, type ReactNode } from 'react';
import { AlertTriangle, Bot, Download, LineChart, LoaderCircle, Radar, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ModuleShell } from '@/features/treasury/module-shell';
import {
  useAccountsQuery,
  useCreateForecastMutation,
  useForecastDetailQuery,
  useForecastsQuery,
  useGenerateForecastScenarioMutation,
  usePublishForecastMutation
} from '@/hooks/use-treasury-queries';
import { formatCurrency, formatDate, formatPercent } from '@/lib/format';
import type { ForecastDetail, ForecastListItem } from '@/lib/types';

const ForecastAreaChart = dynamic(
  () => import('@/components/charts/forecast-area-chart').then((module) => module.ForecastAreaChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[360px] w-full rounded-2xl" />
  }
);

const forecastHorizonOptions = [30, 60, 90, 180] as const;
const chartWindowOptions = [30, 60, 90] as const;

function buildIdempotencyKey() {
  return crypto.randomUUID();
}

export function ForecastsView() {
  const [selectedForecastId, setSelectedForecastId] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<(typeof forecastHorizonOptions)[number]>(90);
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [scenarioName, setScenarioName] = useState('');
  const [notes, setNotes] = useState('');
  const [chartWindow, setChartWindow] = useState<(typeof chartWindowOptions)[number]>(60);
  const [selectionPending, startSelectionTransition] = useTransition();
  const deferredChartWindow = useDeferredValue(chartWindow);

  const accountsQuery = useAccountsQuery({ limit: 100 });
  const forecastsQuery = useForecastsQuery({ limit: 12 });
  const createForecastMutation = useCreateForecastMutation();
  const forecastList = forecastsQuery.data?.items ?? [];

  useEffect(() => {
    if (!selectedForecastId && forecastList[0]?.id) {
      setSelectedForecastId(forecastList[0].id);
    }
  }, [forecastList, selectedForecastId]);

  useEffect(() => {
    const availableCurrencies = Array.from(new Set(accountsQuery.data?.items.map((account) => account.currency_code) ?? []));
    if (!availableCurrencies.length) {
      return;
    }

    if (!availableCurrencies.includes(currencyCode)) {
      setCurrencyCode(availableCurrencies[0]);
    }
  }, [accountsQuery.data, currencyCode]);

  const selectedForecastQuery = useForecastDetailQuery(selectedForecastId);
  const selectedForecast = selectedForecastQuery.data ?? null;
  const publishForecastMutation = usePublishForecastMutation(selectedForecastId ?? '');
  const generateScenarioMutation = useGenerateForecastScenarioMutation(selectedForecastId ?? '');

  const availableCurrencies = Array.from(new Set(accountsQuery.data?.items.map((account) => account.currency_code) ?? []));
  const generationEstimate = estimateGenerationTime(horizon);
  const latestCompletedForecast = forecastList.find((forecast) => forecast.generation_status === 'completed') ?? null;
  const accuracyRows = forecastList.filter((forecast) => forecast.accuracy_score !== null);
  const visibleLines = getVisibleLines(selectedForecast, deferredChartWindow);
  const minBuffer = getMinimumBuffer(selectedForecast);

  const metrics = [
    {
      label: 'Latest forecast',
      value: latestCompletedForecast ? `${latestCompletedForecast.horizon_days ?? 0} days` : 'None',
      detail: latestCompletedForecast
        ? `${latestCompletedForecast.scenario_name} in ${latestCompletedForecast.currency_code}`
        : 'Generate the first AI forecast to establish a planning baseline.'
    },
    {
      label: 'Generation state',
      value: selectedForecast?.generation_status ?? 'idle',
      detail:
        selectedForecast?.generation_status === 'completed'
          ? 'Forecast lines and AI narrative are available for review.'
          : selectedForecast
            ? 'The selected forecast is still processing or needs attention.'
            : 'No active forecast selected.'
    },
    {
      label: 'Confidence',
      value: selectedForecast?.confidence_score ? formatPercent(Number(selectedForecast.confidence_score)) : 'n/a',
      detail: 'Average daily confidence across the selected forecast horizon.'
    },
    {
      label: 'Historical accuracy',
      value: accuracyRows[0]?.accuracy_score ? formatPercent(Number(accuracyRows[0].accuracy_score)) : 'n/a',
      detail: accuracyRows[0]
        ? `Most recent completed MAPE ${(accuracyRows[0].accuracy_details.overallMapePct as string | undefined) ?? 'n/a'}%.`
        : 'Accuracy scores appear after forecast periods complete.'
    }
  ];

  const chartData = visibleLines.map((line) => ({
    date: line.forecast_date,
    label: formatChartLabel(line.forecast_date),
    projectedInflow: Number(line.projected_inflow),
    projectedOutflow: Number(line.projected_outflow),
    cumulativeBalance: Number(line.cumulative_balance ?? 0),
    balanceLow: Number(line.balance_low ?? line.cumulative_balance ?? 0),
    balanceHigh: Number(line.balance_high ?? line.cumulative_balance ?? 0)
  }));

  async function handleGenerateForecast() {
    const payload = {
      forecastType: horizon > 90 ? 'long_term' : 'short_term',
      horizon,
      currencyCode,
      scenarioName: scenarioName.trim() || undefined,
      notes: notes.trim() || undefined,
      idempotencyKey: buildIdempotencyKey()
    } as const;

    const result = await createForecastMutation.mutateAsync(payload);
    startSelectionTransition(() => {
      setSelectedForecastId(result.forecastId);
    });
  }

  async function handleGenerateStressScenario() {
    if (!selectedForecastId) {
      return;
    }

    const result = await generateScenarioMutation.mutateAsync({
      inflow_change_pct: -20,
      outflow_change_pct: 0,
      scenario_name: `${selectedForecast?.scenario_name ?? 'Base'} stress -20% inflows`,
      idempotencyKey: buildIdempotencyKey()
    });

    startSelectionTransition(() => {
      setSelectedForecastId(result.forecastId);
    });
  }

  function handleDownloadCsv() {
    if (!selectedForecast) {
      return;
    }

    const rows = selectedForecast.lines.map((line) =>
      [
        line.forecast_date,
        line.projected_inflow,
        line.projected_outflow,
        line.projected_net,
        line.cumulative_balance ?? '',
        line.confidence_score ?? '',
        line.balance_low ?? '',
        line.balance_high ?? '',
        JSON.stringify(line.key_drivers)
      ].join(',')
    );

    const csv = [
      'date,projected_inflow,projected_outflow,projected_net,cumulative_balance,confidence_score,balance_low,balance_high,key_drivers',
      ...rows
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = downloadUrl;
    anchor.download = `${selectedForecast.scenario_name.replace(/\s+/g, '-').toLowerCase()}-forecast.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(downloadUrl);
  }

  return (
    <ModuleShell
      eyebrow="Forecasts"
      title="Claude-backed cash forecasting with scenario stress testing."
      description="Generate daily cash forecasts from 90 days of treasury history, inspect the confidence band, and publish scenarios with AI-generated treasury commentary."
      primaryAction={
        selectedForecast?.status === 'draft' && selectedForecast.generation_status === 'completed' ? (
          <Button type="button" onClick={() => publishForecastMutation.mutate()} disabled={publishForecastMutation.isPending}>
            {publishForecastMutation.isPending ? 'Publishing…' : 'Publish Forecast'}
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={handleDownloadCsv} disabled={!selectedForecast}>
            <Download className="h-4 w-4" />
            Download CSV
          </Button>
        )
      }
      secondaryAction={
        <Button
          type="button"
          variant="ghost"
          onClick={handleGenerateStressScenario}
          disabled={!selectedForecastId || selectedForecast?.generation_status !== 'completed' || generateScenarioMutation.isPending}
        >
          {generateScenarioMutation.isPending ? 'Generating Stress Scenario…' : 'Generate Stressed Scenario'}
        </Button>
      }
      metrics={metrics}
    >
      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <Card className="section-frame">
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-amber-100/70 via-transparent to-emerald-100/60" />
          <CardHeader className="relative border-b border-slate-100 pb-4">
            <CardDescription>Section 1</CardDescription>
            <CardTitle>Generate Forecast</CardTitle>
          </CardHeader>
          <CardContent className="relative space-y-5 pt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm text-slate-600">
                <span className="font-medium text-slate-900">Horizon</span>
                <Select value={String(horizon)} onChange={(event) => setHorizon(Number(event.target.value) as (typeof forecastHorizonOptions)[number])}>
                  {forecastHorizonOptions.map((option) => (
                    <option key={option} value={option}>
                      {option} days
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-2 text-sm text-slate-600">
                <span className="font-medium text-slate-900">Currency</span>
                <Select value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)}>
                  {(availableCurrencies.length > 0 ? availableCurrencies : ['USD', 'EUR', 'GBP']).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <label className="space-y-2 text-sm text-slate-600">
              <span className="font-medium text-slate-900">Scenario name</span>
              <Input
                value={scenarioName}
                onChange={(event) => setScenarioName(event.target.value)}
                placeholder="Optional scenario label"
              />
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span className="font-medium text-slate-900">Treasury notes</span>
              <Input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional context for seasonality, capex, or collections timing"
              />
            </label>
            <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
              <div className="flex items-start gap-3">
                <Radar className="mt-0.5 h-5 w-5 text-amber-700" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900">Estimated generation time</p>
                  <p className="text-sm text-slate-600">
                    {generationEstimate} seconds. Horizons above 30 days are queued asynchronously and return immediately.
                  </p>
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="accent"
              className="w-full"
              onClick={handleGenerateForecast}
              disabled={createForecastMutation.isPending}
            >
              {createForecastMutation.isPending ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Analyzing 90 days of transaction history…
                </>
              ) : (
                <>
                  <Bot className="h-4 w-4" />
                  Generate AI Forecast
                </>
              )}
            </Button>
            {(selectedForecast?.generation_status === 'queued' || selectedForecast?.generation_status === 'running') ? (
              <div className="rounded-3xl border border-sky-200 bg-sky-50/80 p-4 text-sm text-sky-900">
                Forecast generation is {selectedForecast.generation_status}. This view will refresh automatically until the AI output is persisted.
              </div>
            ) : null}
            {selectedForecast?.generation_status === 'failed' ? (
              <div className="rounded-3xl border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-800">
                {selectedForecast.generation_error ?? 'Forecast generation failed. Review the backend logs and retry the request.'}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="section-frame">
          <CardHeader className="border-b border-slate-100 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardDescription>Section 2</CardDescription>
                <CardTitle>Forecast Visualization</CardTitle>
              </div>
              <div className="flex flex-wrap gap-2">
                {chartWindowOptions.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={chartWindow === option ? 'default' : 'outline'}
                    onClick={() => setChartWindow(option)}
                  >
                    {option} day view
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {selectedForecastQuery.isLoading || selectionPending ? (
              <Skeleton className="h-[360px] w-full rounded-2xl" />
            ) : chartData.length > 0 ? (
              <ForecastAreaChart
                data={chartData}
                currencyCode={selectedForecast?.currency_code ?? currencyCode}
                minBuffer={minBuffer}
                title="AI cash flow forecast"
              />
            ) : (
              <EmptyState
                icon={<LineChart className="h-5 w-5" />}
                title="No forecast lines available"
                description="Generate or select a completed forecast to inspect projected inflows, outflows, and cumulative cash."
              />
            )}
            <div className="grid gap-3 md:grid-cols-3">
              <MetricStrip
                label="Projected inflow"
                value={formatCurrency(sumLines(visibleLines, 'projected_inflow'), selectedForecast?.currency_code ?? currencyCode)}
              />
              <MetricStrip
                label="Projected outflow"
                value={formatCurrency(sumLines(visibleLines, 'projected_outflow'), selectedForecast?.currency_code ?? currencyCode)}
              />
              <MetricStrip
                label="Ending balance"
                value={formatCurrency(visibleLines.at(-1)?.cumulative_balance ?? '0', selectedForecast?.currency_code ?? currencyCode)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="section-frame">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardDescription>Section 3</CardDescription>
            <CardTitle>AI Insights Panel</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 pt-6 md:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-white/80 p-5">
                <p className="eyebrow">Scenario Summary</p>
                <p className="mt-3 text-sm leading-6 text-slate-700">
                  {selectedForecast?.ai_summary ?? 'Generate a forecast to receive the Claude scenario narrative.'}
                </p>
              </div>
              <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-700" />
                  <p className="text-sm font-semibold text-slate-900">Key risks</p>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {(selectedForecast?.key_risks ?? []).length > 0 ? (
                    selectedForecast?.key_risks.map((risk) => <li key={risk}>• {risk}</li>)
                  ) : (
                    <li>No risks are available yet.</li>
                  )}
                </ul>
              </div>
            </div>
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50/75 p-5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-emerald-700" />
                <p className="text-sm font-semibold text-slate-900">Recommended actions</p>
              </div>
              <ol className="mt-3 space-y-3 text-sm text-slate-700">
                {(selectedForecast?.recommended_actions ?? []).length > 0 ? (
                  selectedForecast?.recommended_actions.map((action, index) => (
                    <li key={`${index + 1}-${action}`} className="flex gap-3">
                      <span className="font-semibold text-emerald-700">{index + 1}.</span>
                      <span>{action}</span>
                    </li>
                  ))
                ) : (
                  <li>No recommended actions are available yet.</li>
                )}
              </ol>
            </div>
          </CardContent>
        </Card>

        <Card className="section-frame">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardDescription>Section 4</CardDescription>
            <CardTitle>Forecast Accuracy</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {accuracyRows.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Forecast Date</TableHead>
                    <TableHead>Horizon</TableHead>
                    <TableHead>MAPE %</TableHead>
                    <TableHead>Accuracy Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accuracyRows.map((forecast) => (
                    <TableRow key={forecast.id} onClick={() => setSelectedForecastId(forecast.id)} className="cursor-pointer">
                      <TableCell>{formatDate(forecast.start_date)}</TableCell>
                      <TableCell>{forecast.horizon_days ?? 'n/a'} days</TableCell>
                      <TableCell>{String(forecast.accuracy_details.overallMapePct ?? 'n/a')}</TableCell>
                      <TableCell>{getAccuracyLabel(forecast)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={<Radar className="h-5 w-5" />}
                title="Accuracy history is empty"
                description="Accuracy scores appear after a forecast horizon closes and actual transactions are compared with projected daily nets."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </ModuleShell>
  );
}

function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-sm text-slate-600">
      <div className="flex items-center gap-2 text-slate-900">
        {icon}
        <p className="font-semibold">{title}</p>
      </div>
      <p className="mt-2 leading-6">{description}</p>
    </div>
  );
}

function MetricStrip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function estimateGenerationTime(horizon: number) {
  if (horizon <= 30) {
    return 18;
  }
  if (horizon <= 90) {
    return 45;
  }
  return 70;
}

function getVisibleLines(forecast: ForecastDetail | null, preferredWindow: number) {
  if (!forecast) {
    return [];
  }

  const scenarioLines = forecast.lines
    .filter((line) => line.scenario === forecast.scenario_name)
    .sort((left, right) => left.forecast_date.localeCompare(right.forecast_date));

  return scenarioLines.slice(0, Math.min(preferredWindow, scenarioLines.length));
}

function sumLines(lines: ForecastDetail['lines'], field: 'projected_inflow' | 'projected_outflow') {
  return lines.reduce((sum, line) => sum + Number(line[field]), 0);
}

function formatChartLabel(date: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${date}T00:00:00`));
}

function getMinimumBuffer(forecast: ForecastDetail | null) {
  const policies = forecast?.prompt_context.treasuryPolicies as { minimumBalance?: string } | undefined;
  return policies?.minimumBalance ? Number(policies.minimumBalance) : null;
}

function getAccuracyLabel(forecast: ForecastListItem) {
  const score = forecast.accuracy_score ? Number(forecast.accuracy_score) : null;

  if (score === null) {
    return 'Pending';
  }
  if (score >= 0.9) {
    return 'High';
  }
  if (score >= 0.75) {
    return 'Moderate';
  }
  return 'Low';
}
