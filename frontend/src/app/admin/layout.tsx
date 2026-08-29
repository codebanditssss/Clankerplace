// Admin console layout. Gated by requireAdmin() — non-admins get a 404
// (notFound), never a 403, so the URL doesn't even acknowledge the
// admin surface exists. Also injects a meta robots noindex/nofollow so
// the route can't be indexed even if it leaked.

import { notFound } from "next/navigation";
import { Metadata } from "next";
import { NotAdminError, requireAdmin } from "@/lib/admin";
import { AdminShell } from "@/components/admin/admin-shell";

export const metadata: Metadata = {
  title: "FuelBorn admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (err) {
    if (err instanceof NotAdminError) {
      notFound();
    }
    throw err;
  }
  return <AdminShell adminEmail={admin.email}>{children}</AdminShell>;
}
