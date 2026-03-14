'use client';

import { useEffect } from 'react';
import { AlertCircle, BellRing, CheckCircle2, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Notification } from '@/lib/types';

const severityStyles = {
  info: {
    border: 'border-sky-500',
    icon: BellRing
  },
  success: {
    border: 'border-emerald-500',
    icon: CheckCircle2
  },
  warning: {
    border: 'border-amber-500',
    icon: TriangleAlert
  },
  error: {
    border: 'border-rose-500',
    icon: AlertCircle
  }
} as const;

interface ToastNotificationProps {
  notification: Notification;
  onClose: () => void;
  onClick: () => void;
}

export function ToastNotification({ notification, onClose, onClick }: ToastNotificationProps) {
  useEffect(() => {
    const timeout = window.setTimeout(onClose, 5_000);
    return () => window.clearTimeout(timeout);
  }, [onClose]);

  const Icon = severityStyles[notification.severity].icon;

  return (
    <div
      className={cn(
        'group pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/95 shadow-2xl shadow-slate-950/10 backdrop-blur-md',
        'animate-[slide-in-right_220ms_ease-out]',
        severityStyles[notification.severity].border
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start gap-3 px-4 py-4 text-left transition hover:bg-slate-50/80"
      >
        <div className="mt-0.5 rounded-full bg-slate-100 p-2 text-slate-700">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950">{notification.title}</p>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">{notification.body}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss notification"
        className="absolute right-3 top-3 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
