"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useMe } from "@/hooks/useMe";
import { canOpen } from "@/lib/nav";

/**
 * Sends people where they belong instead of showing them a wall.
 *
 * **The rule** (roadmap §2.5): lacking permission for a page is not an error,
 * it is a signal you belong somewhere else. So redirect where a sensible
 * destination exists, and show *not found* only where none does — never a 403
 * page. A 403 confirms the page exists, which tells somebody without access
 * something about the shape of the system they were not given.
 *
 * **What writing it revealed.** The rule reads as two branches, and in practice
 * it is almost always one: every signed-in company user has `/portal`, so a
 * sensible destination essentially always exists. The 404 branch survives for
 * paths that match no navigation item at all, and that is Next's own
 * `not-found` — already correct, and nothing here needs to reproduce it. So
 * this component redirects and does not fabricate a 404 case to justify the
 * second half of a sentence.
 *
 * **This is not the security boundary.** The API refuses independently and
 * keeps returning 403 to a developer, which is correct and legible. This is
 * about a person meeting a dead end in a menu, which is a design failure rather
 * than an attack.
 */
export default function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: me, isLoading } = useMe();

  const permissions = me?.permissions;
  const allowed =
    !me || canOpen(pathname, permissions ?? []);

  useEffect(() => {
    // Wait for the answer. Redirecting while `/me/` is in flight would bounce
    // somebody off a page they are perfectly entitled to, which is worse than
    // a moment of nothing.
    if (isLoading || !me || allowed) return;
    router.replace("/portal");
  }, [isLoading, me, allowed, router]);

  // Render nothing rather than the forbidden page while the redirect runs —
  // otherwise the content flashes up before it is taken away, which is both
  // alarming and, for a payroll screen, a genuine disclosure.
  if (!allowed) return null;

  return <>{children}</>;
}
