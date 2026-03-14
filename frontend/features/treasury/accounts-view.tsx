'use client';

import { useMemo, useState } from 'react';
import { AccountTable } from '@/components/tables/account-table';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleShell } from '@/features/treasury/module-shell';
import { useAccountsQuery } from '@/hooks/use-treasury-queries';

export function AccountsView() {
  const [status, setStatus] = useState<string>('all');
  const query = useAccountsQuery({
    status: status === 'all' ? undefined : (status as 'active' | 'dormant' | 'closed')
  });

  const accounts = query.data?.items ?? [];

  const metrics = useMemo(
    () => [
      {
        label: 'Connected accounts',
        value: String(accounts.length),
        detail: 'Across all active treasury banking rails'
      },
      {
        label: 'Active accounts',
        value: String(accounts.filter((item) => item.status === 'active').length),
        detail: 'Operational and collection-capable accounts'
      },
      {
        label: 'Restricted accounts',
        value: String(accounts.filter((item) => item.withdrawal_restricted).length),
        detail: 'Accounts with withdrawal restrictions or trapped liquidity'
      },
      {
        label: 'Currencies',
        value: String(new Set(accounts.map((item) => item.currency_code)).size),
        detail: 'Distinct reporting currencies in play'
      }
    ],
    [accounts]
  );

  return (
    <ModuleShell
      eyebrow="Accounts"
      title="Multi-bank account control for treasury operations."
      description="Monitor account status, currency coverage, and connector readiness without leaving the treasury operating shell."
      primaryAction="Add bank account"
      secondaryAction="Sync connectors"
      metrics={metrics}
    >
      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <AccountTable
          accounts={accounts}
          toolbar={
            <label>
              <span className="sr-only">Filter accounts by status</span>
              <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="dormant">Dormant</option>
                <option value="closed">Closed</option>
              </Select>
            </label>
          }
        />
        <Card>
          <CardHeader>
            <CardDescription>Connector health</CardDescription>
            <CardTitle>Bank sync posture</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              ['J.P. Morgan', 'Healthy', 'Last sync 4 min ago'],
              ['HSBC Global', 'Healthy', 'Last sync 7 min ago'],
              ['MUFG Treasury', 'Watch', 'Latency above baseline']
            ].map(([name, statusLabel, detail]) => (
              <div key={name} className="rounded-2xl border border-slate-100 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-900">{name}</p>
                  <Badge variant={statusLabel === 'Healthy' ? 'success' : 'warning'}>{statusLabel}</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-500">{detail}</p>
              </div>
            ))}
            {query.error ? (
              <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                Live account data could not be refreshed. Verify the treasury API session and Supabase connectivity.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </ModuleShell>
  );
}
