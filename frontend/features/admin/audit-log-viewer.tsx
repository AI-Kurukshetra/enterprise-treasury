'use client';

import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileSearch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangePicker, type DateRangeValue } from '@/components/ui/date-range-picker';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAdminUsersQuery, useAuditLogsQuery } from '@/hooks/use-treasury-queries';
import { exportAuditLogsCsv } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { AuditLogRecord } from '@/lib/types';

function getCurrentMonthRange(): DateRangeValue {
  const today = new Date();
  return {
    from: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    to: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))
  };
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function actionTone(action: string) {
  const normalized = action.toLowerCase();
  if (normalized.includes('approve')) {
    return 'border border-violet-200 bg-violet-50 text-violet-700';
  }
  if (normalized.includes('delete') || normalized.includes('revoke')) {
    return 'border border-rose-200 bg-rose-50 text-rose-700';
  }
  if (normalized.includes('update') || normalized.includes('patch')) {
    return 'border border-sky-200 bg-sky-50 text-sky-700';
  }
  if (normalized.includes('create') || normalized.includes('insert') || normalized.includes('post ')) {
    return 'border border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  return 'border border-slate-200 bg-slate-50 text-slate-700';
}

function collectChangedKeys(previousState: Record<string, unknown> | null, newState: Record<string, unknown> | null) {
  const keys = new Set<string>([
    ...Object.keys(previousState ?? {}),
    ...Object.keys(newState ?? {})
  ]);

  return Array.from(keys).filter((key) => JSON.stringify(previousState?.[key]) !== JSON.stringify(newState?.[key]));
}

export function AuditLogViewer() {
  const [range, setRange] = useState<DateRangeValue>(getCurrentMonthRange);
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const auditLogQuery = useAuditLogsQuery({
    fromDate: toIsoDate(range.from),
    toDate: toIsoDate(range.to),
    userId: userId || undefined,
    action: action || undefined,
    entityType: entityType || undefined,
    search: search || undefined,
    limit: 100
  });
  const usersQuery = useAdminUsersQuery();

  const items = useMemo(
    () => auditLogQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [auditLogQuery.data]
  );

  const filteredItems = useMemo(() => {
    if (!deferredSearch) {
      return items;
    }

    return items.filter((item) => {
      const haystack = [
        item.userEmail ?? '',
        item.action,
        item.entityType,
        item.entityId ?? '',
        item.requestId ?? ''
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(deferredSearch);
    });
  }, [deferredSearch, items]);

  const actionOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.action))).sort(),
    [items]
  );
  const entityOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.entityType))).sort(),
    [items]
  );

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,248,0.96))]">
        <CardHeader className="border-b border-slate-100">
          <CardDescription>Audit Log Viewer</CardDescription>
          <CardTitle>Read-only operational trace with filterable evidence export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <DateRangePicker value={range} onChange={setRange} />
            <div className="grid gap-4 rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">User</span>
                <Select value={userId} onChange={(event) => setUserId(event.target.value)}>
                  <option value="">All users</option>
                  {usersQuery.data?.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name ?? user.email}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Action</span>
                <Select value={action} onChange={(event) => setAction(event.target.value)}>
                  <option value="">All actions</option>
                  {actionOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Entity type</span>
                <Select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
                  <option value="">All entity types</option>
                  {entityOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Search</span>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Request ID, entity, or user"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              {filteredItems.length} log entries loaded{deferredSearch ? ` for "${deferredSearch}"` : ''}.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                exportAuditLogsCsv({
                  fromDate: toIsoDate(range.from),
                  toDate: toIsoDate(range.to),
                  userId: userId || undefined,
                  action: action || undefined,
                  entityType: entityType || undefined,
                  search: search || undefined,
                  limit: 5000
                })
              }
            >
              <Download className="h-4 w-4" />
              Export to CSV
            </Button>
          </div>

          {filteredItems.length ? (
            <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="w-12 px-4 py-3 font-medium" />
                      <th className="px-4 py-3 font-medium">Timestamp</th>
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Action</th>
                      <th className="px-4 py-3 font-medium">Entity Type</th>
                      <th className="px-4 py-3 font-medium">Entity ID</th>
                      <th className="px-4 py-3 font-medium">Request ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => {
                      const isExpanded = expandedRowId === item.id;
                      const changedKeys = collectChangedKeys(item.previousState, item.newState);

                      return (
                        <Fragment key={item.id}>
                          <tr className="border-t border-slate-100 align-top">
                            <td className="px-4 py-4">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpandedRowId((current) => (current === item.id ? null : item.id))}
                                aria-label={isExpanded ? 'Collapse audit row' : 'Expand audit row'}
                              >
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </Button>
                            </td>
                            <td className="px-4 py-4 text-slate-700">{formatDateTime(item.createdAt)}</td>
                            <td className="px-4 py-4 text-slate-700">{item.userEmail ?? 'System'}</td>
                            <td className="px-4 py-4">
                              <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${actionTone(item.action)}`}>
                                {item.action}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-slate-700">{item.entityType}</td>
                            <td className="px-4 py-4 font-mono text-xs text-slate-600">{item.entityId ?? 'N/A'}</td>
                            <td className="px-4 py-4 font-mono text-xs text-slate-600">{item.requestId ?? 'N/A'}</td>
                          </tr>
                          {isExpanded ? (
                            <tr className="border-t border-dashed border-slate-100 bg-[#faf7f1]">
                              <td colSpan={7} className="px-6 py-5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline">{changedKeys.length} changed keys</Badge>
                                  {changedKeys.map((key) => (
                                    <Badge key={key} className="border border-violet-200 bg-violet-50 text-violet-700">
                                      {key}
                                    </Badge>
                                  ))}
                                </div>
                                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                                  <StatePanel title="Previous state" value={item.previousState} />
                                  <StatePanel title="New state" value={item.newState} />
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-slate-300 bg-white/80 text-center text-slate-500">
              <FileSearch className="h-8 w-8" />
              <p className="font-medium text-slate-700">No audit logs in the selected range</p>
              <p className="max-w-xl text-sm">Adjust the filters or widen the date window to retrieve operational evidence.</p>
            </div>
          )}

          {auditLogQuery.hasNextPage ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => auditLogQuery.fetchNextPage()} disabled={auditLogQuery.isFetchingNextPage}>
                {auditLogQuery.isFetchingNextPage ? 'Loading more...' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function StatePanel({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
      </div>
      <pre className="max-h-80 overflow-auto px-4 py-4 text-xs leading-6 text-slate-600">
        {value ? JSON.stringify(value, null, 2) : 'No captured state'}
      </pre>
    </div>
  );
}
