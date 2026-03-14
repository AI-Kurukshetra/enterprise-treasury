'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, BellRing, CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsQuery
} from '@/hooks/use-treasury-queries';
import { formatElapsedTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Notification } from '@/lib/types';

const severityMap = {
  info: BellRing,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle
} as const;

interface NotificationPanelProps {
  onNavigate?: () => void;
}

export function NotificationPanel({ onNavigate }: NotificationPanelProps) {
  const router = useRouter();
  const notificationsQuery = useNotificationsQuery({ limit: 20 });
  const markReadMutation = useMarkNotificationReadMutation();
  const markAllReadMutation = useMarkAllNotificationsReadMutation();
  const notifications = notificationsQuery.data?.items ?? [];

  async function handleNotificationClick(notification: Notification) {
    if (!notification.is_read) {
      await markReadMutation.mutateAsync(notification.id);
    }

    onNavigate?.();
    if (notification.action_url) {
      router.push(notification.action_url);
    } else {
      router.push('/notifications');
    }
  }

  return (
    <div className="w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-[28px] border border-white/70 bg-white/95 shadow-2xl shadow-slate-950/10 backdrop-blur-xl">
      <div className="border-b border-slate-200/80 px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Treasury alerts</p>
            <h3 className="text-lg font-semibold text-slate-950">Notifications</h3>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending || notifications.length === 0}
          >
            {markAllReadMutation.isPending ? 'Marking...' : 'Mark all read'}
          </Button>
        </div>
      </div>
      <div className="max-h-[26rem] overflow-y-auto">
        {notificationsQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading notifications...
          </div>
        ) : notifications.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <BellRing className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-medium text-slate-900">No notifications</p>
            <p className="mt-1 text-sm text-slate-500">New approvals, forecast updates, and risk alerts will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.map((notification) => {
              const Icon = severityMap[notification.severity];

              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => void handleNotificationClick(notification)}
                  className={cn(
                    'flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-slate-50',
                    !notification.is_read && 'bg-amber-50/40'
                  )}
                >
                  <div className="mt-0.5 rounded-full bg-slate-100 p-2 text-slate-700">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-950">{notification.title}</p>
                      <span className="shrink-0 text-xs text-slate-400">
                        {formatElapsedTime(Date.parse(notification.created_at))}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">{notification.body}</p>
                    {notification.action_label ? (
                      <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                        {notification.action_label}
                      </p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="border-t border-slate-200/80 px-5 py-3">
        <Link
          href="/notifications"
          onClick={onNavigate}
          className="text-sm font-medium text-slate-700 transition hover:text-slate-950"
        >
          View all
        </Link>
      </div>
    </div>
  );
}
