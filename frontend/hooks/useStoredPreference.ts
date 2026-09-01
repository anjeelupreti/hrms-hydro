"use client";

/**
 * A display preference kept in `localStorage`, read the way React wants
 * browser state read.
 *
 * **The pattern this replaces.** Three screens did the same thing by hand:
 * start on a fallback, read storage in an effect, `setState`. It works, but it
 * paints the wrong value first and then corrects it — a table flickers from
 * cards to list on every load — and `react-hooks/set-state-in-effect` flags it
 * because that is a cascading render, not an edge case.
 *
 * `useSyncExternalStore` is the primitive for exactly this. It takes a *server*
 * snapshot used for SSR and the hydration render, and a *client* snapshot used
 * afterwards; React swaps between them itself, with no effect, no extra render
 * pass, and no hydration mismatch. The stored value is live from the first
 * post-hydration paint.
 *
 * **Why the parsed value is cached.** `getSnapshot` must return a stable
 * reference or React re-renders forever comparing a fresh object to the last
 * one. So each key holds its last raw string beside the value parsed from it,
 * and re-parses only when the raw string actually changed.
 *
 * **Why `storage` events are listened to.** The same preference in two tabs
 * should not disagree, and the browser only fires `storage` in the *other*
 * tabs — so local writes notify the local listeners directly.
 */

import { useCallback, useSyncExternalStore } from "react";

type Cached = { raw: string | null; value: unknown };

const cache = new Map<string, Cached>();
//: Used only where `localStorage` is unavailable — private mode, blocked
//: storage, a full quota. The preference then lasts the session instead of
//: silently doing nothing, which is what a cache the reader never consults
//: would have produced: the button would click and the view would not change.
const memory = new Map<string, unknown>();
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Tell every hook on this page that a key changed. */
function announce() {
  listeners.forEach((notify) => notify());
}

function read<T>(key: string, fallback: T, parse: (raw: string) => T | null): T {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // Nothing to read from, so this session's own choice is the best answer.
    // Not being able to remember a preference across reloads is not an error
    // worth surfacing to somebody trying to look at a list.
    return memory.has(key) ? (memory.get(key) as T) : fallback;
  }

  const cached = cache.get(key);
  if (cached && cached.raw === raw) return cached.value as T;

  let value = fallback;
  if (raw !== null) {
    const parsed = parse(raw);
    // `null` means the stored string is not a value this preference accepts —
    // an old format, or a hand-edited key. Fall back rather than trusting it.
    if (parsed !== null) value = parsed;
  }
  cache.set(key, { raw, value });
  return value;
}

export function useStoredPreference<T>(
  key: string,
  /**
   * Keep this stable across renders — a module constant or a primitive. A
   * fresh object literal each render makes the server snapshot a new reference
   * every time, which React treats as a change.
   */
  fallback: T,
  /** Turn the stored string into a value, or `null` to reject it. */
  parse: (raw: string) => T | null,
  /** Turn a value into the stored string. Defaults to `String`. */
  serialise: (value: T) => string = String
): [T, (next: T) => void] {
  const getSnapshot = useCallback(() => read(key, fallback, parse), [key, fallback, parse]);
  // The server has no localStorage, so it renders the fallback — which is also
  // what the hydration render uses, so the two agree by construction.
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (next: T) => {
      const raw = serialise(next);
      try {
        window.localStorage.setItem(key, raw);
        // Seeded so the next snapshot skips a re-parse, not so it can disagree
        // with what was just written.
        cache.set(key, { raw, value: next });
      } catch {
        // Refusing the change because it cannot be remembered would be worse
        // than forgetting it — the click should still do something.
        memory.set(key, next);
      }
      announce();
    },
    [key, serialise]
  );

  return [value, set];
}
