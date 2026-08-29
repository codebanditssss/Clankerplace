import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { POD_TYPES } from "@/lib/pod-types";

/**
 * /deploy — landing-page-friendly entry point for "I want to deploy a pod".
 *
 * The landing site (port 4000) deep-links here with `?type=<slug>` so that
 * clicking "Deploy" on a pod card lands the user inside the dashboard with
 * the deploy wizard already open and the right pod type pre-selected.
 *
 * Behaviour:
 *   • Unauthenticated  -> /login (existing auth wall; post-login lands on /).
 *   • Unknown `?type=` -> /?new (overview opens the wizard with the picker).
 *   • Known `?type=`   -> /?new=<slug> (overview opens wizard pre-picked).
 *
 * Next 16: `searchParams` is a Promise in server components and must be
 * awaited (see node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/page.md). Sync access throws "should be awaited".
 */
export default async function DeployRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const raw = Array.isArray(sp.type) ? sp.type[0] : sp.type;
  const known = raw && POD_TYPES.some((t) => t.slug === raw) ? raw : null;

  redirect(known ? `/?new=${encodeURIComponent(known)}` : `/?new`);
}
