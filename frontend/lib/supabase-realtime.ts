'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { treasuryQueryKeys } from '@/hooks/use-treasury-queries';
import { getSupabaseBrowserClient } from '@/lib/supabase-client';
import { useEvent } from '@/lib/use-event';
import type { Notification } from '@/lib/types';

const SEEN_TOAST_STORAGE_KEY = 'atlas.notifications.seen-toast-ids';
const SOUND_PREFERENCE_KEY = 'atlas.notifications.sound';
const MAX_SEEN_IDS = 100;

interface UseRealtimeNotificationsOptions {
  playSound?: boolean;
}

interface ToastItem {
  id: string;
  notification: Notification;
}

function readSeenNotificationIds(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(SEEN_TOAST_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function persistSeenNotificationIds(ids: string[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(SEEN_TOAST_STORAGE_KEY, JSON.stringify(ids.slice(-MAX_SEEN_IDS)));
}

function shouldPlayNotificationSound(explicitValue?: boolean) {
  if (explicitValue !== undefined) {
    return explicitValue;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(SOUND_PREFERENCE_KEY) !== 'off';
}

function playNotificationSound() {
  if (typeof window === 'undefined') {
    return;
  }

  const audioContext = new window.AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = 880;
  gain.gain.value = 0.02;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.12);
  oscillator.onended = () => {
    void audioContext.close().catch(() => undefined);
  };
}

export function useRealtimeNotifications(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  options: UseRealtimeNotificationsOptions = {}
) {
  const queryClient = useQueryClient();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pulseKey, setPulseKey] = useState(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set(readSeenNotificationIds()));
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectAttemptRef = useRef(0);
  const [reconnectVersion, setReconnectVersion] = useState(0);

  const dismissToast = useEvent((notificationId: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== notificationId));
  });

  const handleInsert = useEvent((notification: Notification) => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.notificationsCount() })
    ]);

    setPulseKey((value) => value + 1);

    if (seenIdsRef.current.has(notification.id)) {
      return;
    }

    seenIdsRef.current.add(notification.id);
    persistSeenNotificationIds(Array.from(seenIdsRef.current));
    setToasts((current) => [{ id: notification.id, notification }, ...current].slice(0, 4));

    if (shouldPlayNotificationSound(options.playSound)) {
      try {
        playNotificationSound();
      } catch {
        // Ignore audio permission or autoplay failures.
      }
    }
  });

  useEffect(() => {
    if (!userId || !orgId) {
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const channelName = `notifications:${orgId}:${userId}:${reconnectVersion}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          handleInsert(payload.new as Notification);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          reconnectAttemptRef.current = 0;
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (reconnectTimeoutRef.current) {
            window.clearTimeout(reconnectTimeoutRef.current);
          }

          const delay = Math.min(1_000 * (reconnectAttemptRef.current + 1), 5_000);
          reconnectAttemptRef.current += 1;
          reconnectTimeoutRef.current = window.setTimeout(() => {
            setReconnectVersion((value) => value + 1);
          }, delay);
        }
      });

    channelRef.current = channel;

    return () => {
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }

      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [handleInsert, orgId, reconnectVersion, userId, options.playSound]);

  return {
    toasts,
    dismissToast,
    pulseKey
  };
}
