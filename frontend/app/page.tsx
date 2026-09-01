import { redirect } from "next/navigation";

/**
 * There is no landing page.
 *
 * This is one company's internal system, not a product with a funnel in front
 * of it — nobody arrives here to be sold anything. `proxy.ts` already sends an
 * unauthenticated visitor to `/login` and a signed-in one to `/dashboard`;
 * this exists so a direct render (a prefetch, a crawler, the matcher changing
 * under someone) still lands somewhere real rather than on a blank route.
 */
export default function RootPage() {
  redirect("/dashboard");
}
