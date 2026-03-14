'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Loader2, LogOut, Search, Settings2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { getSupabaseBrowserClient } from '@/lib/supabase-client';

export function AppHeader({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const [isSigningOut, startSignOutTransition] = useTransition();

  function handleSignOut() {
    startSignOutTransition(async () => {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.replace('/login');
      router.refresh();
    });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-background/90 backdrop-blur-xl">
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 xl:px-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Today</p>
            <p className="text-sm text-slate-600">Saturday, March 14, 2026</p>
          </div>
          <div className="flex items-center gap-2">
            <p className="hidden rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 md:block">
              {userEmail ?? 'Unknown user'}
            </p>
            <NotificationBell />
            <Button variant="ghost" size="sm" aria-label="Open settings">
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Sign out"
              onClick={handleSignOut}
              disabled={isSigningOut}
            >
              {isSigningOut ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing out...
                </>
              ) : (
                <>
                  <LogOut className="h-4 w-4" />
                  Sign out
                </>
              )}
            </Button>
            <Link
              href="/"
              className="focus-ring rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Marketing site
            </Link>
          </div>
        </div>
        <label className="relative block" htmlFor="global-search">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <span className="sr-only">Search treasury data</span>
          <Input
            id="global-search"
            placeholder="Search accounts, payments, entities, policies"
            className="pl-10"
          />
        </label>
      </div>
    </header>
  );
}
