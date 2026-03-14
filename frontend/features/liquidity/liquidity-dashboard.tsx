'use client';

import { useMemo, useState } from 'react';
import { ArrowRightLeft, RefreshCcw, Waves } from 'lucide-react';
import { LiquidityAnalyticsChart } from '@/components/charts/liquidity-analytics-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SlideOver } from '@/components/ui/slide-over';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ModuleShell } from '@/features/treasury/module-shell';
import {
  useCreateIntercompanyLoanMutation,
  useCurrentProfileQuery,
  useIntercompanyLoansQuery,
  useLiquidityPoolDetailQuery,
  useLiquidityPoolsQuery,
  useLiquidityPositionQuery,
  useRunLiquidityPoolSweepMutation
} from '@/hooks/use-treasury-queries';
import { formatCurrency, formatDate } from '@/lib/format';
import { getPreferredOrganizationId } from '@/lib/session';
import type { IntercompanyLoan, LiquidityPoolSummary } from '@/lib/types';

const tabs = [
  { key: 'pools', label: 'Pools & Sweeping' },
  { key: 'position', label: 'Position Analysis' },
  { key: 'loans', label: 'Intercompany Loans' }
] as const;

type LiquidityTab = (typeof tabs)[number]['key'];

const defaultLoanForm = {
  lenderEntityId: '',
  borrowerEntityId: '',
  amount: '',
  currencyCode: 'USD',
  interestRate: '',
  maturityDate: ''
};

function getDefaultLoanForm() {
  return { ...defaultLoanForm };
}

export function LiquidityDashboard() {
  const [activeTab, setActiveTab] = useState<LiquidityTab>('pools');
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [loanPanelOpen, setLoanPanelOpen] = useState(false);
  const [loanForm, setLoanForm] = useState(getDefaultLoanForm);

  const profileQuery = useCurrentProfileQuery();
  const organizationId = profileQuery.data?.memberships[0]?.organizationId ?? getPreferredOrganizationId();
  const canRead = useMemo(
    () => Object.values(profileQuery.data?.permissions ?? {}).some((permissions) => permissions.includes('liquidity.read')),
    [profileQuery.data?.permissions]
  );
  const canWrite = useMemo(
    () => Object.values(profileQuery.data?.permissions ?? {}).some((permissions) => permissions.includes('liquidity.write')),
    [profileQuery.data?.permissions]
  );
  const queriesEnabled = Boolean(organizationId) && canRead;

  const poolsQuery = useLiquidityPoolsQuery({}, queriesEnabled);
  const positionQuery = useLiquidityPositionQuery({}, queriesEnabled);
  const loansQuery = useIntercompanyLoansQuery({}, queriesEnabled);
  const poolDetailQuery = useLiquidityPoolDetailQuery(selectedPoolId, queriesEnabled);
  const createLoanMutation = useCreateIntercompanyLoanMutation();

  const pools = poolsQuery.data ?? [];
  const position = positionQuery.data;
  const loans = loansQuery.data ?? [];

  const metrics = useMemo(
    () => [
      {
        label: 'Total pooled cash',
        value: formatCurrency(position?.total_balance ?? '0', 'USD'),
        detail: 'Current balances across physical and notional structures.'
      },
      {
        label: 'Available liquidity',
        value: formatCurrency(position?.available_balance ?? '0', 'USD'),
        detail: 'Deployable cash after local and structural constraints.'
      },
      {
        label: 'Trapped cash',
        value: formatCurrency(position?.trapped_cash ?? '0', 'USD'),
        detail: 'Cash held behind concentration or operating friction.'
      },
      {
        label: 'Runway',
        value: position?.runway_days ? `${position.runway_days} days` : 'N/A',
        detail: 'Coverage based on current operating liquidity.'
      }
    ],
    [position]
  );

  const chartData = useMemo(
    () =>
      (position?.concentration_analysis.by_region ?? []).map((bucket) => ({
        label: bucket.label,
        operating: Number(bucket.operating_cash ?? '0'),
        reserve: Number(bucket.reserve_cash ?? '0'),
        trapped: Number(bucket.trapped_cash ?? '0')
      })),
    [position?.concentration_analysis.by_region]
  );

  async function handleCreateLoan() {
    await createLoanMutation.mutateAsync({
      lenderEntityId: loanForm.lenderEntityId,
      borrowerEntityId: loanForm.borrowerEntityId,
      amount: normalizeMoneyInput(loanForm.amount),
      currencyCode: loanForm.currencyCode,
      interestRate: loanForm.interestRate ? normalizeMoneyInput(loanForm.interestRate) : undefined,
      maturityDate: loanForm.maturityDate || undefined
    });

    setLoanPanelOpen(false);
    setLoanForm(getDefaultLoanForm());
  }

  if (profileQuery.isLoading) {
    return (
      <ModuleShell
        eyebrow="Liquidity"
        title="Liquidity management command surface."
        description="Monitor pooling, sweeping, and intercompany funding with treasury-grade controls."
        metrics={metrics}
      >
        <Card>
          <CardContent className="py-10 text-sm text-slate-500">Loading treasury access context…</CardContent>
        </Card>
      </ModuleShell>
    );
  }

  if (!canRead) {
    return (
      <ModuleShell
        eyebrow="Liquidity"
        title="Liquidity management command surface."
        description="Monitor pooling, sweeping, and intercompany funding with treasury-grade controls."
        metrics={metrics}
      >
        <Card>
          <CardContent className="py-10 text-sm text-slate-600">
            Liquidity data requires the `liquidity.read` permission.
          </CardContent>
        </Card>
      </ModuleShell>
    );
  }

  return (
    <>
      <ModuleShell
        eyebrow="Liquidity"
        title="Liquidity management command surface."
        description="Balance concentration, sweep discipline, and intercompany funding from one operating layer with current position context."
        primaryAction={
          <Button type="button" onClick={() => positionQuery.refetch()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh position
          </Button>
        }
        secondaryAction={
          canWrite ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLoanForm(getDefaultLoanForm());
                setLoanPanelOpen(true);
              }}
            >
              <ArrowRightLeft className="h-4 w-4" />
              Create loan
            </Button>
          ) : undefined
        }
        metrics={metrics}
      >
        <div className="flex flex-wrap gap-3">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              type="button"
              variant={activeTab === tab.key ? 'default' : 'outline'}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {activeTab === 'pools' ? (
          <section className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            {pools.map((pool) => (
              <PoolCard key={pool.id} pool={pool} canWrite={canWrite} onInspect={() => setSelectedPoolId(pool.id)} />
            ))}
            {pools.length === 0 ? (
              <Card className="lg:col-span-2 2xl:col-span-3">
                <CardContent className="py-12 text-sm text-slate-500">
                  No liquidity pools are configured for the active organization.
                </CardContent>
              </Card>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'position' ? (
          <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
            <Card>
              <CardHeader className="border-b border-slate-100 pb-4">
                <CardDescription>Regional composition</CardDescription>
                <CardTitle>Operating, reserve, and trapped cash by region</CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <LiquidityAnalyticsChart data={chartData} title="Liquidity composition by region" />
              </CardContent>
            </Card>

            <Card className="border-slate-800 bg-slate-950 text-slate-50">
              <CardHeader className="border-b border-slate-800/70 pb-4">
                <CardDescription className="text-slate-300">Runway</CardDescription>
                <CardTitle className="text-slate-50">Available liquidity coverage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <p className="text-4xl font-semibold">{position?.runway_days ? `${position.runway_days}d` : 'N/A'}</p>
                <p className="text-sm leading-6 text-slate-300">
                  Coverage uses current operating liquidity as the near-term consumption proxy.
                </p>
                <div className="rounded-2xl border border-slate-800/80 bg-slate-900 px-4 py-4 text-sm text-slate-300">
                  {formatCurrency(position?.available_balance ?? '0', 'USD')} currently deployable
                </div>
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader className="border-b border-slate-100 pb-4">
                <CardDescription>Concentration controls</CardDescription>
                <CardTitle>Policy limits and breach indicators</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Region</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Share</TableHead>
                      <TableHead>Limit</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(position?.concentration_analysis.by_region ?? []).map((bucket) => (
                      <TableRow key={bucket.key}>
                        <TableCell className="font-semibold text-slate-900">{bucket.label}</TableCell>
                        <TableCell>{formatCurrency(bucket.total_balance, 'USD')}</TableCell>
                        <TableCell>{formatPct(bucket.concentration_pct)}</TableCell>
                        <TableCell>{formatPct(bucket.limit_pct)}</TableCell>
                        <TableCell>
                          <Badge variant={bucket.breached ? 'danger' : 'success'}>
                            {bucket.breached ? 'breached' : 'within policy'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>
        ) : null}

        {activeTab === 'loans' ? (
          <Card>
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardDescription>Intercompany funding</CardDescription>
                  <CardTitle>Active and proposed loan positions</CardTitle>
                </div>
                {canWrite ? (
                    <Button
                      type="button"
                      onClick={() => {
                        setLoanForm(getDefaultLoanForm());
                        setLoanPanelOpen(true);
                      }}
                    >
                      Create Loan
                    </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="px-0 pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lender</TableHead>
                    <TableHead>Borrower</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Maturity</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loans.map((loan) => (
                    <TableRow key={loan.id}>
                      <TableCell className="font-mono text-xs text-slate-700">{truncateId(loan.lender_entity_id)}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-700">{truncateId(loan.borrower_entity_id)}</TableCell>
                      <TableCell>{formatCurrency(loan.amount, loan.currency_code)}</TableCell>
                      <TableCell>{loan.interest_rate ? `${Number(loan.interest_rate).toFixed(2)}%` : 'N/A'}</TableCell>
                      <TableCell>{loan.maturity_date ? formatDate(loan.maturity_date) : 'Open'}</TableCell>
                      <TableCell>
                        <LoanStatusBadge loan={loan} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {loans.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center text-sm text-slate-500">
                        No intercompany loan records are available.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}
      </ModuleShell>

      <SlideOver
        open={Boolean(selectedPoolId)}
        onClose={() => setSelectedPoolId(null)}
        title={poolDetailQuery.data?.name ?? 'Liquidity pool detail'}
        description="Inspect member accounts, current balances, and active sweeping rules before triggering controlled movement."
      >
        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b border-slate-100 pb-4">
              <CardDescription>Pool snapshot</CardDescription>
              <CardTitle>{poolDetailQuery.data?.summary.name ?? 'Loading pool'}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
              <MetricBlock label="Total balance" value={formatCurrency(poolDetailQuery.data?.summary.total_balance ?? '0', 'USD')} />
              <MetricBlock label="Available" value={formatCurrency(poolDetailQuery.data?.summary.available_balance ?? '0', 'USD')} />
              <MetricBlock label="Trapped" value={formatCurrency(poolDetailQuery.data?.summary.trapped_cash ?? '0', 'USD')} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-slate-100 pb-4">
              <CardDescription>Member accounts</CardDescription>
              <CardTitle>Account composition</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-6">
              {(poolDetailQuery.data?.accounts ?? []).map((account) => (
                <div key={account.id} className="rounded-2xl border border-slate-100 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{account.account_name ?? account.bank_account_id}</p>
                      <p className="text-sm text-slate-500">
                        {account.account_number_masked ?? account.bank_account_id} • priority {account.priority}
                      </p>
                    </div>
                    <Badge variant="secondary">{account.currency_code ?? 'N/A'}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <MetricBlock label="Current" value={formatCurrency(account.current_balance ?? '0', account.currency_code ?? 'USD')} />
                    <MetricBlock label="Available" value={formatCurrency(account.available_balance ?? '0', account.currency_code ?? 'USD')} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-slate-100 pb-4">
              <CardDescription>Sweeping rules</CardDescription>
              <CardTitle>Execution controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-6">
              {(poolDetailQuery.data?.rules ?? []).map((rule) => (
                <div key={rule.id} className="rounded-2xl border border-slate-100 px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{rule.rule_name}</p>
                      <p className="text-sm text-slate-500">
                        {rule.frequency} cadence • source {truncateId(rule.source_account_id)} to {truncateId(rule.target_account_id)}
                      </p>
                    </div>
                    <Badge variant={rule.is_active ? 'success' : 'secondary'}>{rule.is_active ? 'active' : 'inactive'}</Badge>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <MetricBlock label="Min" value={formatCurrency(rule.min_balance, poolDetailQuery.data?.base_currency ?? 'USD')} />
                    <MetricBlock label="Target" value={formatCurrency(rule.target_balance, poolDetailQuery.data?.base_currency ?? 'USD')} />
                    <MetricBlock label="Max transfer" value={formatCurrency(rule.max_transfer ?? '0', poolDetailQuery.data?.base_currency ?? 'USD')} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </SlideOver>

      <SlideOver
        open={loanPanelOpen}
        onClose={() => setLoanPanelOpen(false)}
        title="Create intercompany loan"
        description="New loans stay in proposed status until bilateral approval is completed on both sides."
      >
        <div className="space-y-4">
          <label className="space-y-2 text-sm text-slate-600">
            <span className="block font-medium text-slate-900">Lender entity ID</span>
            <Input value={loanForm.lenderEntityId} onChange={(event) => setLoanForm((current) => ({ ...current, lenderEntityId: event.target.value }))} />
          </label>
          <label className="space-y-2 text-sm text-slate-600">
            <span className="block font-medium text-slate-900">Borrower entity ID</span>
            <Input value={loanForm.borrowerEntityId} onChange={(event) => setLoanForm((current) => ({ ...current, borrowerEntityId: event.target.value }))} />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-600">
              <span className="block font-medium text-slate-900">Amount</span>
              <Input value={loanForm.amount} onChange={(event) => setLoanForm((current) => ({ ...current, amount: event.target.value }))} />
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span className="block font-medium text-slate-900">Currency</span>
              <Select value={loanForm.currencyCode} onChange={(event) => setLoanForm((current) => ({ ...current, currencyCode: event.target.value }))}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="SGD">SGD</option>
              </Select>
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-600">
              <span className="block font-medium text-slate-900">Interest rate</span>
              <Input value={loanForm.interestRate} onChange={(event) => setLoanForm((current) => ({ ...current, interestRate: event.target.value }))} placeholder="4.250000" />
            </label>
            <label className="space-y-2 text-sm text-slate-600">
              <span className="block font-medium text-slate-900">Maturity date</span>
              <Input type="date" value={loanForm.maturityDate} onChange={(event) => setLoanForm((current) => ({ ...current, maturityDate: event.target.value }))} />
            </label>
          </div>
          {createLoanMutation.error ? (
            <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{createLoanMutation.error.message}</p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLoanForm(getDefaultLoanForm());
                setLoanPanelOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateLoan} disabled={createLoanMutation.isPending}>
              {createLoanMutation.isPending ? 'Creating…' : 'Create loan'}
            </Button>
          </div>
        </div>
      </SlideOver>
    </>
  );
}

function PoolCard({
  pool,
  canWrite,
  onInspect
}: {
  pool: LiquidityPoolSummary;
  canWrite: boolean;
  onInspect: () => void;
}) {
  const sweepMutation = useRunLiquidityPoolSweepMutation(pool.id);

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute right-4 top-4 rounded-full border border-[#d1b190] bg-[#f5e6d5] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#855128]">
        <Waves className="mr-2 inline h-3.5 w-3.5" />
        {pool.pool_type}
      </div>
      <CardHeader className="border-b border-slate-100 pb-4">
        <CardDescription>Liquidity pool</CardDescription>
        <CardTitle className="pr-20">{pool.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricBlock label="Total balance" value={formatCurrency(pool.total_balance, pool.base_currency)} />
          <MetricBlock label="Accounts" value={String(pool.account_count)} />
          <MetricBlock label="Active rules" value={String(pool.active_rule_count)} />
          <MetricBlock label="Last sweep" value={pool.last_sweep_at ? formatDate(pool.last_sweep_at) : 'Not run'} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={onInspect}>
            View detail
          </Button>
          {canWrite ? (
            <Button type="button" onClick={() => sweepMutation.mutate()} disabled={sweepMutation.isPending}>
              {sweepMutation.isPending ? 'Running' : 'Run Sweep'}
            </Button>
          ) : null}
        </div>
        {sweepMutation.data?.length ? (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            Last manual run: {sweepMutation.data.filter((result) => result.status === 'executed').length} rules executed,{' '}
            {sweepMutation.data.filter((result) => result.status === 'skipped').length} skipped.
          </div>
        ) : null}
        {sweepMutation.error ? (
          <div className="rounded-2xl bg-rose-50 px-4 py-4 text-sm text-rose-700">{sweepMutation.error.message}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LoanStatusBadge({ loan }: { loan: IntercompanyLoan }) {
  const status = loan.display_status ?? loan.status;
  const variant = status === 'overdue' ? 'danger' : status === 'settled' ? 'success' : status === 'active' ? 'warning' : 'secondary';
  return <Badge variant={variant}>{status}</Badge>;
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 px-4 py-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function formatPct(value?: string) {
  if (!value) {
    return '0.0%';
  }

  return `${(Number(value) * 100).toFixed(1)}%`;
}

function truncateId(value: string) {
  return `${value.slice(0, 8)}…`;
}

function normalizeMoneyInput(value: string) {
  const normalized = value.trim().replace(/,/g, '');
  if (!normalized) {
    return '0.000000';
  }

  const [integerPart = '0', fractionalPart = ''] = normalized.split('.');
  return `${integerPart}.${fractionalPart.padEnd(6, '0').slice(0, 6)}`;
}
