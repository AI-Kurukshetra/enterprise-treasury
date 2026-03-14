'use client';

import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/tables/data-table';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Account } from '@/lib/types';

function getStatusVariant(status: Account['status']) {
  switch (status) {
    case 'active':
      return 'success';
    case 'dormant':
      return 'warning';
    case 'closed':
      return 'danger';
  }
}

function getReconciliationVariant(status: NonNullable<Account['reconciliation_status']>) {
  switch (status) {
    case 'reconciled':
      return 'success';
    case 'attention':
      return 'warning';
    case 'no_activity':
      return 'secondary';
  }
}

const columns: DataTableColumn<Account>[] = [
  {
    key: 'account',
    header: 'Account',
    render: (account) => (
      <div className="space-y-1">
        <p className="font-semibold text-slate-900">{account.account_name}</p>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">
          {account.account_number_masked}
        </p>
      </div>
    ),
    sortValue: (account) => account.account_name
  },
  {
    key: 'currency',
    header: 'Currency',
    render: (account) => account.currency_code,
    sortValue: (account) => account.currency_code
  },
  {
    key: 'balance',
    header: 'Balance',
    render: (account) => (
      <div className="space-y-1">
        <p className="font-semibold text-slate-900">
          {formatCurrency(account.current_balance ?? '0', account.currency_code)}
        </p>
        <p className="text-xs text-slate-500">
          Available {formatCurrency(account.available_balance ?? '0', account.currency_code)}
        </p>
      </div>
    ),
    sortValue: (account) => Number(account.current_balance ?? '0')
  },
  {
    key: 'status',
    header: 'Status',
    render: (account) => <Badge variant={getStatusVariant(account.status)}>{account.status}</Badge>,
    sortValue: (account) => account.status
  },
  {
    key: 'reconciliation',
    header: 'Reconciliation status',
    render: (account) => (
      <Badge variant={getReconciliationVariant(account.reconciliation_status ?? 'no_activity')}>
        {account.reconciliation_status === 'attention'
          ? 'Needs review'
          : account.reconciliation_status === 'reconciled'
            ? 'Reconciled'
            : 'No activity'}
      </Badge>
    ),
    sortValue: (account) => account.reconciliation_status ?? 'no_activity'
  },
  {
    key: 'updated',
    header: 'Updated',
    render: (account) => formatDate(account.updated_at),
    sortValue: (account) => new Date(account.updated_at).getTime()
  }
];

export function AccountTable({
  accounts,
  toolbar
}: {
  accounts: Account[];
  toolbar?: React.ReactNode;
}) {
  return (
    <DataTable
      title="Account registry"
      caption="Bank account registry with sortable operational metadata."
      data={accounts}
      columns={columns}
      getRowId={(account) => account.id}
      searchPlaceholder="Search account name, mask, or currency"
      searchKeys={[
        (account) => account.account_name,
        (account) => account.account_number_masked,
        (account) => account.currency_code
      ]}
      toolbar={toolbar}
      emptyMessage="No accounts matched the current criteria."
      pageSize={6}
      defaultSortKey="updated"
    />
  );
}
