'use client';

import { useMemo, useState } from 'react';
import { TransactionTable } from '@/components/tables/transaction-table';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ImportWizard } from '@/features/transactions/import-wizard';
import { ModuleShell } from '@/features/treasury/module-shell';
import { useTransactionsQuery } from '@/hooks/use-treasury-queries';
import { formatCurrency } from '@/lib/format';

export function TransactionsView() {
  const [direction, setDirection] = useState<string>('all');
  const [reconciliationStatus, setReconciliationStatus] = useState<string>('all');
  const query = useTransactionsQuery({
    direction: direction === 'all' ? undefined : (direction as 'inflow' | 'outflow'),
    reconciliationStatus:
      reconciliationStatus === 'all'
        ? undefined
        : (reconciliationStatus as 'unreconciled' | 'partially_reconciled' | 'reconciled' | 'exception')
  });

  const transactions = query.data?.items ?? [];
  const metrics = useMemo(
    () => [
      {
        label: 'Transactions in view',
        value: String(transactions.length),
        detail: 'Current ledger window with applied filters'
      },
      {
        label: 'Inflow volume',
        value: formatCurrency(
          transactions
            .filter((item) => item.direction === 'inflow')
            .reduce((sum, item) => sum + Number(item.amount), 0)
        ),
        detail: 'Collections and intercompany receipts'
      },
      {
        label: 'Outflow volume',
        value: formatCurrency(
          transactions
            .filter((item) => item.direction === 'outflow')
            .reduce((sum, item) => sum + Number(item.amount), 0)
        ),
        detail: 'Operating, tax, payroll, and supplier payments'
      },
      {
        label: 'Unreconciled items',
        value: String(transactions.filter((item) => item.reconciliation_status !== 'reconciled').length),
        detail: 'Requires matching or manual review'
      }
    ],
    [transactions]
  );

  return (
    <ModuleShell
      eyebrow="Transactions"
      title="Treasury-grade transaction visibility with reconciliation context."
      description="Work large transaction sets quickly with sortable activity, reconciliation status, and directional filters tuned for treasury controls."
      primaryAction={<ImportWizard />}
      secondaryAction="Open reconciliation queue"
      metrics={metrics}
    >
      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <TransactionTable
          transactions={transactions}
          toolbar={
            <div className="flex flex-wrap gap-3">
              <label>
                <span className="sr-only">Filter transactions by direction</span>
                <Select value={direction} onChange={(event) => setDirection(event.target.value)}>
                  <option value="all">All directions</option>
                  <option value="inflow">Inflow</option>
                  <option value="outflow">Outflow</option>
                </Select>
              </label>
              <label>
                <span className="sr-only">Filter transactions by reconciliation status</span>
                <Select
                  value={reconciliationStatus}
                  onChange={(event) => setReconciliationStatus(event.target.value)}
                >
                  <option value="all">All reconciliation</option>
                  <option value="reconciled">Reconciled</option>
                  <option value="partially_reconciled">Partial match</option>
                  <option value="unreconciled">Unreconciled</option>
                  <option value="exception">Exception</option>
                </Select>
              </label>
            </div>
          }
        />
        <Card>
          <CardHeader>
            <CardDescription>Operational guidance</CardDescription>
            <CardTitle>Reconciliation focus</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              ['Same-day inflows', 'Prioritize customer sweeps above $5M first.'],
              ['Unmatched tax flows', 'Review value-date offsets before escalation.'],
              ['Intercompany transfers', 'Confirm pool legs before month-end close.']
            ].map(([title, text], index) => (
              <div key={title} className="rounded-2xl border border-slate-100 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-900">{title}</p>
                  <Badge variant={index === 1 ? 'warning' : 'secondary'}>Focus</Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>
              </div>
            ))}
            {query.error ? (
              <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                Live transaction data could not be refreshed. Showing last-known seeded data.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </ModuleShell>
  );
}
