'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEvent } from '@/lib/use-event';
import { cn } from '@/lib/utils';

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

const focusableSelector =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SlideOver({ open, onClose, title, description, children, className }: SlideOverProps) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setVisible(false);
    const timeout = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(timeout);
  }, [open]);

  const handleKeyDown = useEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab' || !panelRef.current) {
      return;
    }

    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector));
    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });

  useEffect(() => {
    if (!mounted) {
      document.body.style.removeProperty('overflow');
      previousFocusRef.current?.focus();
      return;
    }

    document.body.style.setProperty('overflow', 'hidden');
    const focusable = panelRef.current?.querySelector<HTMLElement>(focusableSelector);
    focusable?.focus();

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.removeProperty('overflow');
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, mounted]);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" aria-hidden={!open}>
      <button
        type="button"
        aria-label="Close panel"
        className={cn(
          'absolute inset-0 bg-slate-950/30 backdrop-blur-[1px] transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'relative z-10 flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(244,247,248,0.96))] shadow-2xl transition-transform duration-200 ease-out',
          visible ? 'translate-x-0' : 'translate-x-full',
          className
        )}
      >
        <div className="border-b border-slate-200/80 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="eyebrow">Treasury Action</p>
              <h2 id={titleId} className="text-2xl font-semibold text-slate-950">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="max-w-xl text-sm leading-6 text-slate-600">
                  {description}
                </p>
              ) : null}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close slide-over">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>,
    document.body
  );
}
