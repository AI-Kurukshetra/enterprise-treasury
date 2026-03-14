'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', textAlign: 'center', fontFamily: 'sans-serif', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#0f172a' }}>
            {error.message || 'Application error'}
          </h2>
          {error.digest && (
            <p style={{ fontSize: '12px', color: '#94a3b8' }}>Error ID: {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{ padding: '8px 20px', background: '#0f172a', color: 'white', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
