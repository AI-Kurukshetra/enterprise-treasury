'use client';

import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/tables/data-table';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Transaction } from '@/lib/types';

const columns: DataTableColumn<Transaction>[] = [
  {
    key: 'date',
    header: 'Booking date',
    render: (transaction) => formatDate(transaction.booking_date),
    sortValue: (transaction) => new Date(transaction.booking_date).getTime()
  },
  {
    key: 'description',
    header: 'Description',
    render: (transaction) => (
      <div className="space-y-1">
        <p className="font-semibold text-slate-900">{transaction.description ?? 'Bank transaction'}</p>
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-slate-500">
          {transaction.bank_account_id}
        </p>
      </div>
    ),
    sortValue: (transaction) => transaction.description ?? ''
  },
  {
    key: 'direction',
    header: 'Direction',
    render: (transaction) => (
      <span className="inline-flex items-center gap-2">
        {transaction.direction === 'inflow' ? (
          <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
        ) : (
          <ArrowUpRight className="h-4 w-4 text-amber-600" />
        )}
        {transaction.direction}
      </span>
    ),
    sortValue: (transaction) => transaction.direction
  },
  {
    key: 'amount',
    header: 'Amount',
    render: (transaction) => formatCurrency(transaction.amount, transaction.currency_code),
    sortValue: (transaction) => Number(transaction.amount)
  },
  {
    key: 'reconciliation',
    header: 'Reconciliation',
    render: (transaction) => (
      <Badge
        variant={
          transaction.reconciliation_status === 'reconciled'
            ? 'success'
            : transaction.reconciliation_status === 'exception'
              ? 'danger'
              : 'warning'
        }
      >
        {transaction.reconciliation_status}
      </Badge>
    ),
    sortValue: (transaction) => transaction.reconciliation_status
  }
];

export function TransactionTable({
  transactions,
  toolbar
}: {
  transactions: Transaction[];
  toolbar?: React.ReactNode;
}) {
  return (
    <DataTable
      title="Transaction ledger"
      caption="Normalized transactions with sortable direction, amount, and reconciliation state."
      data={transactions}
      columns={columns}
      getRowId={(transaction) => transaction.id}
      searchPlaceholder="Search description, account, or reconciliation state"
      searchKeys={[
        (transaction) => transaction.description ?? '',
        (transaction) => transaction.bank_account_id,
        (transaction) => transaction.reconciliation_status
      ]}
      toolbar={toolbar}
      emptyMessage="No transactions matched the current criteria."
      pageSize={8}
      defaultSortKey="date"
    />
  );
}
