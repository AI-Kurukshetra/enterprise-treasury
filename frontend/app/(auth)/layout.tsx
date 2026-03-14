import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.16),_transparent_36%),linear-gradient(120deg,_rgba(255,255,255,0.95)_0%,_rgba(226,232,240,0.82)_100%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid w-full overflow-hidden rounded-3xl border border-slate-300/80 bg-white/95 shadow-2xl shadow-slate-900/15 lg:grid-cols-2">
          <section className="relative flex flex-col justify-between bg-[#0f172a] px-8 py-10 text-slate-100 sm:px-10 sm:py-12">
            <div className="space-y-7">
              <div className="inline-flex items-center gap-3 rounded-full border border-slate-600/70 bg-slate-900/40 px-4 py-2">
                <div
                  aria-hidden="true"
                  className="h-8 w-8 rounded-lg border border-slate-500 bg-slate-800/80 p-1.5"
                >
                  <svg viewBox="0 0 40 40" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 8H34V14H23V32H17V14H6V8Z" fill="#E2E8F0" />
                    <path d="M23 14H34V20H29V32H23V14Z" fill="#94A3B8" />
                  </svg>
                </div>
                <span className="font-semibold tracking-wide">Atlas Treasury</span>
              </div>
              <div className="space-y-3">
                <p className="eyebrow text-slate-400">Enterprise Treasury Management</p>
                <h1 className="text-balance text-3xl font-semibold leading-tight sm:text-4xl">
                  Secure liquidity operations for global finance teams.
                </h1>
                <p className="max-w-md text-sm leading-6 text-slate-300/90">
                  Centralize payment execution, cash visibility, and risk governance across all your entities in one
                  controlled environment.
                </p>
              </div>
            </div>
            <div className="pt-10 text-xs text-slate-400">
              <p>ISO 27001 aligned controls, strict role isolation, and full audit traceability.</p>
            </div>
          </section>
          <section className="bg-white/98 px-6 py-8 sm:px-10 sm:py-12">
            {children}
            <p className="mt-8 text-center text-xs text-slate-500">
              Need help accessing your workspace?{' '}
              <Link href="/" className="focus-ring rounded text-slate-700 underline underline-offset-4">
                Contact your platform administrator
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
