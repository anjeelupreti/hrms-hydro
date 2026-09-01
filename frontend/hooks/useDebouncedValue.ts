"use client";

import { useEffect, useState } from "react";

/**
 * A value that settles after typing stops.
 *
 * Every list search now runs on the server, which is the only way a search can
 * see past the page it has loaded — and it means each keystroke would otherwise
 * be a request. This holds the value until the typing pauses.
 *
 * 250ms: below it a fast typist still fires a request per keystroke; above it
 * the list visibly lags the cursor.
 *
 * Lifted out of `useEntitySearch`, where it lived privately, once a second
 * caller needed it. Two copies of a debounce drift in their delay, and the
 * delay is the whole design.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

export default useDebouncedValue;
