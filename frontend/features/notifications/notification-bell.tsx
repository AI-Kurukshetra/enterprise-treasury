'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NotificationPanel } from '@/features/notifications/notification-panel';
import { ToastNotification } from '@/features/notifications/toast-notification';
import { useNotificationCountQuery, useCurrentProfileQuery } from '@/hooks/use-treasury-queries';
import { useRealtimeNotifications } from '@/lib/supabase-realtime';
import { useEvent } from '@/lib/use-event';
import { cn } from '@/lib/utils';

function getActiveOrganizationId(
  memberships: Array<{ organizationId: string; status: string }> | undefined
) {
  return memberships?.find((membership) => membership.status === 'active')?.organizationId ?? memberships?.[0]?.organizationId ?? null;
}

export function NotificationBell() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const profileQuery = useCurrentProfileQuery();
  const userId = profileQuery.data?.user.id ?? null;
  const organizationId = getActiveOrganizationId(profileQuery.data?.memberships);
  const countQuery = useNotificationCountQuery();
  const { toasts, dismissToast, pulseKey } = useRealtimeNotifications(userId, organizationId);
  const unreadCount = countQuery.data?.unread ?? 0;

  const handleDocumentClick = useEvent((event: MouseEvent) => {
    if (!containerRef.current?.contains(event.target as Node)) {
      setOpen(false);
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [handleDocumentClick, open]);

  return (
    <>
      <div ref={containerRef} className="relative">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open notifications"
          onClick={() => setOpen((current) => !current)}
          className="relative"
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 ? (
            <span
              key={pulseKey}
              className={cn(
                'absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white shadow-lg shadow-rose-600/25',
                pulseKey > 0 && 'animate-notification-badge'
              )}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : (
            <span
              key={pulseKey}
              className={cn(
                'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-transparent',
                pulseKey > 0 && 'bg-rose-500 animate-ping-once'
              )}
            />
          )}
        </Button>
        {open ? (
          <div className="absolute right-0 top-[calc(100%+0.75rem)] z-50">
            <NotificationPanel onNavigate={() => setOpen(false)} />
          </div>
        ) : null}
      </div>
      <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
        {toasts.map((toast) => (
          <ToastNotification
            key={toast.id}
            notification={toast.notification}
            onClose={() => dismissToast(toast.id)}
            onClick={() => {
              dismissToast(toast.id);
              router.push(toast.notification.action_url ?? '/notifications');
            }}
          />
        ))}
      </div>
    </>
  );
}
