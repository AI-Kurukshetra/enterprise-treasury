import { AuditLogViewer } from '@/features/admin/audit-log-viewer';
import { requireServerPermission } from '@/lib/server-auth';

export default async function AuditLogsPage() {
  await requireServerPermission('admin.audit_logs.read');
  return <AuditLogViewer />;
}
