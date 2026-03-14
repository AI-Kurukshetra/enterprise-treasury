'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCurrentProfileQuery } from '@/hooks/use-treasury-queries';
import { navigationSections, utilityNavigation } from '@/lib/navigation';
import { cn } from '@/lib/utils';

function hasNavigationAccess(
  permissions: string[],
  item: { requiredPermissions?: string[]; requiredPermissionPrefixes?: string[] }
) {
  if (item.requiredPermissions?.length && !item.requiredPermissions.some((permission) => permissions.includes(permission))) {
    return false;
  }

  if (
    item.requiredPermissionPrefixes?.length &&
    !permissions.some((permission) => item.requiredPermissionPrefixes!.some((prefix) => permission.startsWith(prefix)))
  ) {
    return false;
  }

  return true;
}

export function AppSidebar() {
  const pathname = usePathname() ?? '';
  const profileQuery = useCurrentProfileQuery();
  const flattenedPermissions = Array.from(
    new Set(Object.values(profileQuery.data?.permissions ?? {}).flatMap((items) => items))
  );

  return (
    <aside className="hidden h-screen w-[276px] shrink-0 border-r border-slate-200/80 bg-[#f6f3ee]/95 px-5 py-6 lg:sticky lg:top-0 lg:block">
      <div className="flex h-full flex-col gap-6">
        <div className="rounded-2xl border border-slate-300/80 bg-slate-950 px-5 py-4 text-slate-50">
          <p className="eyebrow text-slate-400">Atlas Treasury</p>
          <p className="mt-2 text-lg font-semibold">Enterprise Command Center</p>
          <p className="mt-1 text-sm text-slate-300">Liquidity, payments, and policy intelligence.</p>
        </div>

        <nav aria-label="Primary" className="space-y-5">
          {navigationSections.map((section) => {
            const visibleItems = section.items.filter((item) => hasNavigationAccess(flattenedPermissions, item));

            if (visibleItems.length === 0) {
              return null;
            }

            return (
              <div key={section.label} className="space-y-2">
                <p className="eyebrow px-3">{section.label}</p>
                {visibleItems.map((item) => {
                  const isActive = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(`${item.href}/`));
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'focus-ring flex items-start gap-3 rounded-2xl px-3 py-3 transition',
                        isActive ? 'bg-slate-950 text-slate-50' : 'text-slate-700 hover:bg-white'
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="space-y-1">
                        <span className="block text-sm font-semibold">{item.label}</span>
                        <span className={cn('block text-xs', isActive ? 'text-slate-300' : 'text-slate-500')}>
                          {item.shortDescription}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3 rounded-2xl border border-slate-300/80 bg-white px-4 py-4">
          <p className="eyebrow">Operations pulse</p>
          {utilityNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex items-start gap-3 text-sm text-slate-700">
                <Icon className="mt-0.5 h-4 w-4 text-emerald-600" />
                <div>
                  <p className="font-semibold">{item.label}</p>
                  <p className="text-slate-500">{item.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
