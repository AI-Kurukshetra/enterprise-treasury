import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { getSupabaseServerClient } from '@/lib/supabase-server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return <AppShell userEmail={user.email ?? null}>{children}</AppShell>;
}
