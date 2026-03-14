'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[DashboardError]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="space-y-2">
        <p className="eyebrow">Something went wrong</p>
        <h2 className="text-2xl font-semibold text-slate-900">
          {error.message || 'An unexpected error occurred'}
        </h2>
        {error.digest && (
          <p className="text-xs text-slate-400">Error ID: {error.digest}</p>
        )}
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
