'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const CHUNK_RELOAD_GUARD_KEY = 'atlas.accounts.chunk-reload-attempted';

function isChunkLoadFailure(error: Error) {
  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('loading chunk') ||
    message.includes('chunkloaderror') ||
    message.includes('failed to fetch dynamically imported module')
  );
}

export default function AccountsError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!isChunkLoadFailure(error)) {
      return;
    }

    const alreadyRetried = window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === 'true';
    if (alreadyRetried) {
      return;
    }

    window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, 'true');
    window.location.reload();
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white px-6 py-10 shadow-panel">
      <p className="eyebrow">Accounts</p>
      <h2 className="mt-3 text-2xl font-semibold text-slate-900">Unable to load this section</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Atlas Treasury hit a route loading error. This can happen after a new deployment updates client chunks.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={() => {
            window.sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
            reset();
          }}
        >
          Retry
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            window.sessionStorage.removeItem(CHUNK_RELOAD_GUARD_KEY);
            window.location.assign('/accounts');
          }}
        >
          Hard refresh route
        </Button>
        <Link
          href="/dashboard"
          className="focus-ring inline-flex h-10 items-center rounded-full border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to dashboard
        </Link>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        {process.env.NODE_ENV === 'development' ? error.message : 'If this persists, check the latest deployment and clear cached assets.'}
      </p>
    </div>
  );
}
