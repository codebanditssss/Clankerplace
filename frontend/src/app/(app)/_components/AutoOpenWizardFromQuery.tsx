"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Reads `?new` / `?new=<slug>` on mount and dispatches the same
 * `pods:open-wizard` event the sidebar / "N" key / home CTA already use.
 * Then strips the query so the URL doesn't keep re-opening the wizard on
 * back/forward navigation.
 *
 * Mounted on the overview page so deep links from the landing site (which
 * funnel through `/deploy?type=<slug>` → `/?new=<slug>`) auto-open the
 * deploy wizard with the right pod type pre-selected.
 */
export default function AutoOpenWizardFromQuery() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const firedRef = React.useRef(false);

  React.useEffect(() => {
    if (firedRef.current) return;
    if (!sp.has("new")) return;
    firedRef.current = true;

    const type = sp.get("new") || undefined;
    window.dispatchEvent(
      new CustomEvent("pods:open-wizard", { detail: type ? { type } : undefined }),
    );

    // Strip the param so refreshes / back-button don't re-trigger.
    const next = new URLSearchParams(sp.toString());
    next.delete("new");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  return null;
}
