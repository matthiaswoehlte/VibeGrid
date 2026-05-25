import { requireAdminPage } from '@/lib/auth/admin-guard';
import { AdminShell } from '@/components/Admin/AdminShell';

export default async function AdminLayout({
  children
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage();
  return <AdminShell>{children}</AdminShell>;
}
