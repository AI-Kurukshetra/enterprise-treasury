'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/tables/data-table';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Payment } from '@/lib/types';

function getPaymentVariant(status: Payment['status']) {
  switch (status) {
    case 'approved':
    case 'settled':
      return 'success';
    case 'pending_approval':
    case 'draft':
      return 'warning';
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return 'danger';
    default:
      return 'secondary';
  }
}

export function PaymentTable({
  payments,
  toolbar,
  counterpartyNamesById,
  renderActions
}: {
  payments: Payment[];
  toolbar?: React.ReactNode;
  counterpartyNamesById?: Record<string, string>;
  renderActions?: (payment: Payment) => React.ReactNode;
}) {
  const columns: DataTableColumn<Payment>[] = [
    {
      key: 'reference',
      header: 'Reference',
      render: (payment) => (
        <div className="space-y-1">
          <p className="font-semibold text-slate-900">{payment.payment_reference}</p>
          <p className="text-xs text-slate-500">
            {counterpartyNamesById?.[payment.beneficiary_counterparty_id] ?? payment.purpose ?? 'Treasury instruction'}
          </p>
        </div>
      ),
      sortValue: (payment) => payment.payment_reference
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (payment) => formatCurrency(payment.amount, payment.currency_code),
      sortValue: (payment) => Number(payment.amount)
    },
    {
      key: 'valueDate',
      header: 'Value date',
      render: (payment) => formatDate(payment.value_date),
      sortValue: (payment) => new Date(payment.value_date).getTime()
    },
    {
      key: 'status',
      header: 'Status',
      render: (payment) => <Badge variant={getPaymentVariant(payment.status)}>{payment.status.replace('_', ' ')}</Badge>,
      sortValue: (payment) => payment.status
    }
  ];

  if (renderActions) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      render: (payment) => (
        <div className="flex justify-end">
          {renderActions(payment) ?? <Button variant="ghost" size="sm">View</Button>}
        </div>
      ),
      className: 'w-[180px] text-right'
    });
  }

  return (
    <DataTable
      title="Payment queue"
      caption="Payment instructions with sortable approval and release metadata."
      data={payments}
      columns={columns}
      getRowId={(payment) => payment.id}
      searchPlaceholder="Search payment reference, purpose, or status"
      searchKeys={[
        (payment) => payment.payment_reference,
        (payment) => payment.purpose ?? '',
        (payment) => payment.status,
        (payment) => counterpartyNamesById?.[payment.beneficiary_counterparty_id] ?? ''
      ]}
      toolbar={toolbar}
      emptyMessage="No payments matched the current criteria."
      pageSize={6}
      defaultSortKey="valueDate"
      defaultSortDirection="asc"
    />
  );
}
