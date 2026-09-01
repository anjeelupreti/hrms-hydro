"use client";

/**
 * How far the system is through its setup.
 *
 * **Resolved on the server on every read, never cached as done.** A check that
 * still says Done after somebody deleted the salary structure is worse than no
 * check, because it is believed — so this is a short-lived query rather than
 * something written into local state and trusted for the session.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";
import type { SetupReadiness } from "@/types/setup";

const URL = "/api/proxy/organization/setup";


export function useSetupReadiness() {
  return useQuery({
    queryKey: ["setup"],
    queryFn: () => fetchJson<SetupReadiness>(URL),
    // The whole point is that it reflects the world now. The company who has just
    // added their departments in another tab should not be told otherwise.
    staleTime: 0,
  });
}

/** Skip a check with a reason, or undo a skip. Must-haves are refused server-side. */
export function useSkipSetupCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { key: string; reason?: string; skip?: boolean }) =>
      fetchJson<SetupReadiness>(URL, { method: "POST", body: JSON.stringify(values) }),
    onSuccess: (data) => {
      // The response *is* the new readiness, so seed it rather than refetching.
      qc.setQueryData(["setup"], data);
    },
  });
}
