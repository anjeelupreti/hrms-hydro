/**
 * Where an employee is shown. One answer, so there is only one.
 *
 * **The problem this closes.** A person could be opened three different ways
 * depending on which component you happened to click. A name in a grid opened a
 * cut-down drawer; a card in the roster navigated to the full page; the org
 * chart opened the drawer again. Three surfaces meant three sets of facts, and
 * the drawer's set was a guess at "enough" — so somebody following a name from
 * a leave request saw less than somebody who reached the same person from the
 * roster, with nothing on screen to say a fuller view existed.
 *
 * A profile is also a *place*: people bookmark it, paste it into chat, open it
 * in a second tab to compare two records. A drawer has no address, so none of
 * that worked. Every one of those is free once the answer is a route.
 *
 * So: **one route, and every caller comes here to build the link.** A component
 * that needs to send somebody to a person imports `employeeHref`; one that
 * needs to do it from a handler imports `useOpenEmployee`. Neither decides
 * anything.
 */

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/** The canonical address of one person's profile. */
export function employeeHref(id: number | string): string {
  return `/employees/${id}`;
}

/**
 * Navigate to somebody's profile from an event handler.
 *
 * Prefer a real `<a href={employeeHref(id)}>` where the markup allows one —
 * middle-click, ⌘-click and "copy link address" all work on an anchor and none
 * of them work on a click handler. This exists for the cases where an anchor is
 * not available: a node inside an SVG org chart, a row that is already a
 * button, a card whose whole surface is the target.
 */
export function useOpenEmployee() {
  const router = useRouter();
  return useCallback(
    (id: number | string) => router.push(employeeHref(id)),
    [router]
  );
}
