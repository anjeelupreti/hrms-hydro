import RouteLoader from "@/components/shell/RouteLoader";

/**
 * What is shown while a route segment streams in.
 *
 * The framework's own mechanism — React Suspense under the hood — rather than
 * something bolted onto `<Link>`. `useLinkStatus` reports one link's pending
 * state and only works inside that link; this covers every navigation,
 * including the ones nobody clicked (a redirect, a back button, a deep link
 * pasted into the bar).
 *
 * At the root, so no route has to remember to opt in. A segment that wants
 * something richer — a skeleton shaped like its own content — still can, by
 * putting its own `loading.tsx` beside its `page.tsx`, and that one wins for
 * its subtree.
 *
 * **This is also what ends the hold.** React unmounts a `loading.tsx` the
 * moment its segment renders, so the overlay lifts on the *first* piece of the
 * page to arrive rather than waiting for the whole of it — which is why the
 * loader is a hold over the shell and not a substitute for the page.
 */
export default function Loading() {
  return <RouteLoader />;
}
