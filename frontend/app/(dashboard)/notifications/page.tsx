'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertCircle, BellRing, CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useInfiniteNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkNotificationUnreadMutation
} from '@/hooks/use-treasury-queries';
import { formatDateTime, formatElapsedTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Notification } from '@/lib/types';

const filters = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' },
  { label: 'Payments', value: 'payments' },
  { label: 'Risk', value: 'risk' },
  { label: 'System', value: 'system' }
] as const;

const severityIcons = {
  info: BellRing,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle
} as const;

type NotificationFilter = (typeof filters)[number]['value'];

function matchesFilter(notification: Notification, filter: NotificationFilter) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'unread') {
    return !notification.is_read;
  }

  if (filter === 'payments') {
    return notification.type.startsWith('payment.');
  }

  if (filter === 'risk') {
    return notification.type.startsWith('risk.');
  }

  return notification.type.startsWith('system.');
}

export default function NotificationsPage() {
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const notificationsQuery = useInfiniteNotificationsQuery({
    limit: 50,
    isRead: filter === 'unread' ? false : undefined
  });
  const markReadMutation = useMarkNotificationReadMutation();
  const markUnreadMutation = useMarkNotificationUnreadMutation();

  const notifications = useMemo(
    () =>
      (notificationsQuery.data?.pages ?? [])
        .flatMap((page) => page.items)
        .filter((notification) => matchesFilter(notification, filter)),
    [filter, notificationsQuery.data?.pages]
  );

  return (
    <section className="space-y-6">
      <div className="section-frame px-6 py-6 sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow">Notifications</p>
            <h1 className="mt-2 font-[family-name:var(--font-instrument-serif)] text-4xl leading-none text-slate-950">
              Treasury signal queue
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Live approvals, risk alerts, forecast publications, and operational notices. Notifications older than 90 days are
              retained through background cleanup.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {filters.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant={filter === item.value ? 'default' : 'outline'}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {notificationsQuery.isLoading ? (
          <div className="surface-panel flex items-center justify-center gap-3 px-6 py-12 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading notifications...
          </div>
        ) : notifications.length === 0 ? (
          <div className="surface-panel px-6 py-12 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <BellRing className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-medium text-slate-900">No notifications matched this filter</p>
            <p className="mt-2 text-sm text-slate-500">Switch filters or come back when a new treasury event lands.</p>
          </div>
        ) : (
          notifications.map((notification) => {
            const Icon = severityIcons[notification.severity];

            return (
              <article
                key={notification.id}
                className={cn(
                  'surface-panel px-5 py-5 sm:px-6',
                  !notification.is_read && 'border-amber-300/70 bg-amber-50/45'
                )}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-4">
                    <div className="mt-0.5 rounded-full bg-slate-100 p-3 text-slate-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-semibold text-slate-950">{notification.title}</h2>
                        {!notification.is_read ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                            Unread
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{notification.body}</p>
                      <div className="mt-3 flex flex-wrap gap-4 text-xs uppercase tracking-[0.18em] text-slate-400">
                        <span>{formatElapsedTime(Date.parse(notification.created_at))}</span>
                        <span>{formatDateTime(notification.created_at)}</span>
                        <span>{notification.type.replaceAll('.', ' / ')}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-3">
                    {notification.action_url ? (
                      <Button asChild variant="outline">
                        <Link href={notification.action_url}>{notification.action_label ?? 'Open'}</Link>
                      </Button>
                    ) : null}
                    {notification.is_read ? (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => markUnreadMutation.mutate(notification.id)}
                        disabled={markUnreadMutation.isPending}
                      >
                        Mark unread
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => markReadMutation.mutate(notification.id)}
                        disabled={markReadMutation.isPending}
                      >
                        Mark read
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {notificationsQuery.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => notificationsQuery.fetchNextPage()}
            disabled={notificationsQuery.isFetchingNextPage}
          >
            {notificationsQuery.isFetchingNextPage ? 'Loading more...' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
