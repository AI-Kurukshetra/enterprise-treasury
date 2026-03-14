'use client';

import { useMemo, useState } from 'react';
import { Clock3, Download, FileClock, FileStack, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangePicker, type DateRangeValue } from '@/components/ui/date-range-picker';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  useCashSummaryReportQuery,
  useComplianceArchiveQuery,
  useGenerateComplianceReportMutation,
  useLiquidityReportQuery
} from '@/hooks/use-treasury-queries';
import {
  downloadCashSummaryReport,
  downloadComplianceReport,
  downloadLiquidityReport,
  type GenerateComplianceReportInput
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ModuleShell } from '@/features/treasury/module-shell';

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getCurrentMonthRange(): DateRangeValue {
  const today = new Date();
  return {
    from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    to: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))
  };
}

function getStatusVariant(status: string) {
  if (status === 'generated' || status === 'ready' || status === 'synced') {
    return 'success' as const;
  }

  if (status === 'running' || status === 'queued') {
    return 'warning' as const;
  }

  return 'secondary' as const;
}

const scheduledReports = [
  {
    name: 'Daily cash summary',
    cadence: 'Weekdays 06:00 UTC',
    recipients: 'Ops treasury, regional leads',
    lastRun: '2026-03-14T05:58:00.000Z',
    nextRun: '2026-03-15T06:00:00.000Z',
    status: 'ready'
  },
  {
    name: 'Liquidity runway pack',
    cadence: 'Every Monday',
    recipients: 'CFO, VP treasury',
    lastRun: '2026-03-09T08:00:00.000Z',
    nextRun: '2026-03-16T08:00:00.000Z',
    status: 'queued'
  },
  {
    name: 'Monthly compliance package',
    cadence: 'Month-end +1',
    recipients: 'Audit, controllership',
    lastRun: '2026-03-01T02:15:00.000Z',
    nextRun: '2026-04-01T02:15:00.000Z',
    status: 'ready'
  }
];

export function ReportCenter() {
  const [cashRange, setCashRange] = useState<DateRangeValue>(getCurrentMonthRange);
  const [complianceRange, setComplianceRange] = useState<DateRangeValue>(getCurrentMonthRange);
  const [liquidityAsOf, setLiquidityAsOf] = useState(toIsoDate(new Date()));
  const [complianceType, setComplianceType] = useState<GenerateComplianceReportInput['reportType']>('sox_404');
  const [downloadHistory, setDownloadHistory] = useState<Record<'cash' | 'liquidity' | 'compliance', string[]>>({
    cash: [],
    liquidity: [],
    compliance: []
  });

  const cashParams = useMemo(
    () => ({
      periodStart: toIsoDate(cashRange.from),
      periodEnd: toIsoDate(cashRange.to)
    }),
    [cashRange]
  );
  const complianceParams = useMemo(
    () => ({
      periodStart: toIsoDate(complianceRange.from),
      periodEnd: toIsoDate(complianceRange.to)
    }),
    [complianceRange]
  );

  const cashSummaryQuery = useCashSummaryReportQuery(cashParams);
  const liquidityQuery = useLiquidityReportQuery({ asOf: liquidityAsOf });
  const complianceArchiveQuery = useComplianceArchiveQuery();
  const generateComplianceMutation = useGenerateComplianceReportMutation();

  const latestCompliance = useMemo(
    () => complianceArchiveQuery.data?.find((item) => item.reportType === complianceType) ?? null,
    [complianceArchiveQuery.data, complianceType]
  );

  function pushHistory(key: 'cash' | 'liquidity' | 'compliance') {
    setDownloadHistory((current) => ({
      ...current,
      [key]: [new Date().toISOString(), ...current[key]].slice(0, 4)
    }));
  }

  return (
    <ModuleShell
      eyebrow="Reports"
      title="Treasury reporting for cash, liquidity, and audit evidence."
      description="Generate operating packs, inspect the current reporting posture, and keep compliance artifacts within the same command surface."
      primaryAction={
        <Button type="button" variant="accent" onClick={() => generateComplianceMutation.mutate({ ...complianceParams, reportType: complianceType })}>
          <ShieldCheck className="h-4 w-4" />
          Generate compliance package
        </Button>
      }
      secondaryAction={
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            latestCompliance ? downloadComplianceReport(latestCompliance.id).then(() => pushHistory('compliance')) : undefined
          }
          disabled={!latestCompliance}
        >
          <Download className="h-4 w-4" />
          Download latest package
        </Button>
      }
      metrics={[
        {
          label: 'Cash report timestamp',
          value: cashSummaryQuery.data ? formatDateTime(cashSummaryQuery.data.generatedAt) : 'Waiting',
          detail: 'Current standard summary generation point'
        },
        {
          label: 'Liquidity runway',
          value: liquidityQuery.data?.runway.daysOfRunway ? `${liquidityQuery.data.runway.daysOfRunway} days` : 'N/A',
          detail: 'Base-currency runway at trailing 30-day burn'
        },
        {
          label: 'Compliance archive',
          value: String(complianceArchiveQuery.data?.length ?? 0),
          detail: 'Generated packages available for retrieval'
        },
        {
          label: 'Scheduled outputs',
          value: String(scheduledReports.length),
          detail: 'Future automation scope displayed from the target schedule'
        }
      ]}
    >
      <section className="grid gap-6">
        <div className="grid gap-6 xl:grid-cols-3">
          <ReportCard
            icon={FileStack}
            title="Daily Cash Summary"
            description="Opening and closing balances, currency net flows, and top counterparties."
            status={cashSummaryQuery.isFetching ? 'running' : cashSummaryQuery.data ? 'ready' : 'waiting'}
            lastGenerated={cashSummaryQuery.data?.generatedAt ?? null}
            history={downloadHistory.cash}
            controls={
              <>
                <DateRangePicker value={cashRange} onChange={setCashRange} />
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      downloadCashSummaryReport({ ...cashParams, format: 'json' }).then(() => pushHistory('cash'))
                    }
                  >
                    <Download className="h-4 w-4" />
                    Download JSON
                  </Button>
                  <Button
                    type="button"
                    onClick={() => downloadCashSummaryReport({ ...cashParams, format: 'csv' }).then(() => pushHistory('cash'))}
                  >
                    <Download className="h-4 w-4" />
                    Download CSV
                  </Button>
                </div>
              </>
            }
          />

          <ReportCard
            icon={Clock3}
            title="Liquidity Report"
            description="Account liquidity posture, pool composition, runway, and trapped cash."
            status={liquidityQuery.isFetching ? 'running' : liquidityQuery.data ? 'ready' : 'waiting'}
            lastGenerated={liquidityQuery.data?.generatedAt ?? null}
            history={downloadHistory.liquidity}
            controls={
              <>
                <div className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm">
                  <label className="space-y-2">
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">As of date</span>
                    <Input type="date" value={liquidityAsOf} onChange={(event) => setLiquidityAsOf(event.target.value)} />
                  </label>
                </div>
                <Button
                  type="button"
                  onClick={() => downloadLiquidityReport({ asOf: liquidityAsOf, format: 'csv' }).then(() => pushHistory('liquidity'))}
                >
                  <Download className="h-4 w-4" />
                  Download CSV
                </Button>
              </>
            }
          />

          <ReportCard
            icon={ShieldCheck}
            title="Compliance Package"
            description="SOX, regulatory, and audit evidence bundles generated on demand."
            status={generateComplianceMutation.isPending ? 'running' : latestCompliance?.status ?? 'waiting'}
            lastGenerated={latestCompliance?.createdAt ?? null}
            history={[
              ...downloadHistory.compliance,
              ...(complianceArchiveQuery.data?.slice(0, 3).map((item) => item.createdAt) ?? [])
            ].slice(0, 4)}
            controls={
              <>
                <DateRangePicker value={complianceRange} onChange={setComplianceRange} />
                <div className="rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm">
                  <label className="space-y-2">
                    <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Report type</span>
                    <Select value={complianceType} onChange={(event) => setComplianceType(event.target.value as GenerateComplianceReportInput['reportType'])}>
                      <option value="sox_404">SOX 404</option>
                      <option value="regulatory">Regulatory</option>
                      <option value="audit">Audit</option>
                    </Select>
                  </label>
                </div>
                <Button
                  type="button"
                  variant="accent"
                  onClick={() =>
                    generateComplianceMutation.mutate(
                      {
                        reportType: complianceType,
                        ...complianceParams
                      },
                      {
                        onSuccess: () => pushHistory('compliance')
                      }
                    )
                  }
                  disabled={generateComplianceMutation.isPending}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {generateComplianceMutation.isPending ? 'Generating...' : 'Generate package'}
                </Button>
              </>
            }
          />
        </div>

        <Card>
          <CardHeader className="border-b border-slate-100">
            <CardDescription>Scheduled Reports</CardDescription>
            <CardTitle>Display-only scheduling register</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-medium">Report name</th>
                    <th className="px-6 py-3 font-medium">Cadence</th>
                    <th className="px-6 py-3 font-medium">Recipients</th>
                    <th className="px-6 py-3 font-medium">Last run</th>
                    <th className="px-6 py-3 font-medium">Next run</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledReports.map((report) => (
                    <tr key={report.name} className="border-t border-slate-100">
                      <td className="px-6 py-4 font-medium text-slate-900">{report.name}</td>
                      <td className="px-6 py-4 text-slate-600">{report.cadence}</td>
                      <td className="px-6 py-4 text-slate-600">{report.recipients}</td>
                      <td className="px-6 py-4 text-slate-600">{formatDateTime(report.lastRun)}</td>
                      <td className="px-6 py-4 text-slate-600">{formatDateTime(report.nextRun)}</td>
                      <td className="px-6 py-4">
                        <Badge variant={getStatusVariant(report.status)}>{report.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-slate-100">
            <CardDescription>Generated Reports Archive</CardDescription>
            <CardTitle>Past compliance packages</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {complianceArchiveQuery.data?.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-6 py-3 font-medium">Type</th>
                      <th className="px-6 py-3 font-medium">Period</th>
                      <th className="px-6 py-3 font-medium">Generated</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Download</th>
                    </tr>
                  </thead>
                  <tbody>
                    {complianceArchiveQuery.data.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-6 py-4 font-medium text-slate-900">{item.reportType}</td>
                        <td className="px-6 py-4 text-slate-600">
                          {item.periodStart} to {item.periodEnd}
                        </td>
                        <td className="px-6 py-4 text-slate-600">{formatDateTime(item.createdAt)}</td>
                        <td className="px-6 py-4">
                          <Badge variant={getStatusVariant(item.status)}>{item.status}</Badge>
                        </td>
                        <td className="px-6 py-4">
                          <Button type="button" variant="outline" size="sm" onClick={() => downloadComplianceReport(item.id)}>
                            <Download className="h-4 w-4" />
                            Download
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-6 text-center text-slate-500">
                <FileClock className="h-8 w-8" />
                <p className="font-medium text-slate-700">No compliance reports generated yet</p>
                <p className="max-w-xl text-sm">Generate a package above to populate the archive and unlock evidence downloads.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </ModuleShell>
  );
}

function ReportCard({
  icon: Icon,
  title,
  description,
  status,
  lastGenerated,
  history,
  controls
}: {
  icon: typeof FileStack;
  title: string;
  description: string;
  status: string;
  lastGenerated: string | null;
  history: string[];
  controls: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(247,243,236,0.92))]">
      <CardHeader className="border-b border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-slate-50 shadow-lg shadow-slate-950/10">
              <Icon className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
          <Badge variant={getStatusVariant(status)}>{status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {controls}
        <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/75 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Last generated</p>
          <p className="mt-2 text-sm font-medium text-slate-900">{lastGenerated ? formatDateTime(lastGenerated) : 'No generation recorded'}</p>
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Download history</p>
            {history.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {history.map((entry) => (
                  <span key={entry} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                    {formatDateTime(entry)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No downloads in this session yet.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
