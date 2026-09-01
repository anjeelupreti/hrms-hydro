"use client";

import { useIsFetching } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import RouteLoader from "@/components/shell/RouteLoader";

/**
 * Decides *when* the page is being held. `RouteLoader` decides what that looks
 * like.
 *
 * The hold is driven by the queries, not by Suspense. `app/loading.tsx` is the
 * right mechanism for an app whose pages suspend on server data, and this one
 * does not: every screen is a client component that asks React Query for its
 * data after it mounts, so a navigation never suspends — the new page renders
 * instantly, empty, and fills in later, and the Suspense boundary is never
 * crossed.
 *
 * **It lifts on the first section, not the last.** The count climbs as the new
 * page's hooks mount, then falls as answers arrive. The hold ends the first
 * time it *falls*,
 * so a page whose header resolves while its tables are still loading is handed
 * over and read immediately, with its own skeletons carrying the rest. Waiting
 * for zero would mean the slowest query on the page dictates when anything can
 * be seen.
 *
 * React Query serves cached data instantly and then refetches in the
 * background, so returning to a page already visited renders it complete *and*
 * raises the in-flight count — counting every fetch would put frosted glass
 * over a fully drawn page.
 *
 * So the filter counts only queries with **no data yet**. That is the honest
 * definition of the thing being waited for: not "the network is busy" but
 * "there is nothing to show". A background refresh is invisible, as it should
 * be.
 *
 * **A count of zero is not "finished" — at the start it means "not begun".**
 * This component re-renders on the navigation itself, a beat before the new
 * page's hooks have mounted and registered anything, so for a render or two
 * nothing is in flight. Treating that as an answer would release the hold
 * before it ever began, which is exactly the bug the old loader had by another
 * route. The hold therefore waits for the count to *rise* before it will
 * accept a fall — and a page that genuinely asks the server for nothing is
 * released by {@link GRACE_MS} instead, rather than sitting behind glass
 * waiting for a request that is never coming.
 *
 * **It always lets go.** A query that hangs — a dropped connection, a backend
 * that never answers — must not leave somebody stuck behind frosted glass with
 * no way forward. After {@link CEILING_MS} the hold releases regardless and the
 * page shows whatever it has, including its own error states. A loader is a
 * courtesy; it is never allowed to become the thing that traps you.
 *
 * The quarter-second before anything paints lives in `RouteLoader` as a CSS
 * delay, so the common case — a page that answers quickly — mounts and unmounts
 * this without ever showing a frame.
 */

/**
 * How long to wait for a page to ask for anything before assuming it will not.
 *
 * Shorter than the delay `RouteLoader` waits before painting, and deliberately:
 * a page served entirely from cache releases the hold *before* the overlay
 * would have appeared, so the reader never sees a frame of it. A page that has
 * real work to do registers its queries in the same commit as its first render,
 * long inside this window.
 */
const GRACE_MS = 160;

/** The longest the screen may be held, however the queries behave. */
const CEILING_MS = 8000;

type Hold = {
  /** The route this state describes. A mismatch with `pathname` *is* the reset. */
  route: string;
  /** High-water mark of in-flight queries; a fall from it means an answer landed. */
  peak: number;
  /** Set once the page has been handed over to the reader. */
  released: boolean;
};

export default function RouteHold() {
  const pathname = usePathname();
  // Only queries with nothing to show yet. A background refresh of data
  // already on screen is not something to hold the page for — see above.
  const inFlight = useIsFetching({ predicate: (query) => query.state.status === "pending" });
  const [hold, setHold] = useState<Hold>({ route: pathname, peak: 0, released: false });

  // Adjusted during render rather than in an effect — the sanctioned pattern
  // for state that derives from a changing input. An effect runs after the
  // browser has been offered a frame, so resetting there would let one painted
  // frame of the previous route's *released* state through on every
  // navigation: a flash of the answer before the question.
  //
  // Every branch below strictly advances — the route changes once, the peak
  // only climbs, and release is one-way — so this settles rather than looping.
  if (hold.route !== pathname) {
    setHold({ route: pathname, peak: 0, released: false });
  } else if (inFlight > hold.peak) {
    setHold({ ...hold, peak: inFlight });
  } else if (!hold.released && hold.peak > 0 && inFlight < hold.peak) {
    setHold({ ...hold, released: true });
  }

  useEffect(() => {
    // Functional updates in both: these fire long after the render that
    // scheduled them, and the route may well have changed again by then.
    const release = (only: (h: Hold) => boolean) =>
      setHold((h) => (h.route === pathname && !h.released && only(h) ? { ...h, released: true } : h));

    // Nothing ever went out — a page assembled entirely from cache, or one
    // that simply has nothing to fetch.
    const grace = setTimeout(() => release((h) => h.peak === 0), GRACE_MS);
    // Something went out and never came back.
    const ceiling = setTimeout(() => release(() => true), CEILING_MS);
    return () => {
      clearTimeout(grace);
      clearTimeout(ceiling);
    };
  }, [pathname]);

  if (hold.route === pathname && hold.released) return null;
  return <RouteLoader />;
}
