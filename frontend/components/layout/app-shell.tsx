import { AppHeader } from '@/components/layout/app-header';
import { AppSidebar } from '@/components/layout/app-sidebar';

export function AppShell({ children, userEmail }: { children: React.ReactNode; userEmail: string | null }) {
  return (
    <div className="min-h-screen lg:flex">
      <AppSidebar />
      <div className="min-w-0 flex-1">
        <AppHeader userEmail={userEmail} />
        <main id="main-content" className="px-4 py-6 sm:px-6 xl:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
