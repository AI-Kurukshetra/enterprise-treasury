import { AdminConsole } from '@/features/admin/admin-console';
import { requireServerAdminAccess } from '@/lib/server-auth';

export default async function AdminPage() {
  await requireServerAdminAccess();
  return <AdminConsole />;
}
