"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/apiError";
import type { TeamCatalogue, TeamMember } from "@/types/team";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, response.status));
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function useTeam() {
  return useQuery({
    queryKey: ["team", "members"],
    queryFn: async () =>
      (await fetchJson<{ members: TeamMember[] }>("/api/proxy/accounts/team")).members,
  });
}

/**
 * The roles and permissions that exist.
 *
 * Served rather than hardcoded: a copy of the permission list in TypeScript is
 * a copy that drifts from `policy.py`, and the drift is invisible — a screen
 * offering a capability the server deleted just 403s on click.
 */
export function useTeamCatalogue() {
  return useQuery({
    queryKey: ["team", "catalogue"],
    queryFn: () => fetchJson<TeamCatalogue>("/api/proxy/accounts/team/catalogue"),
    staleTime: Infinity,
  });
}

/** Invalidate both: a role change drops grants, so the list is stale too. */
function useTeamMutation<TArgs>(fn: (args: TArgs) => Promise<TeamMember>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
      // The signed-in user may have just changed their own reach.
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useSetRole() {
  return useTeamMutation<{ userId: number; role: string }>(({ userId, role }) =>
    fetchJson<TeamMember>(`/api/proxy/accounts/team/${userId}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    })
  );
}

export function useGrantPermission() {
  return useTeamMutation<{ userId: number; permission: string }>(({ userId, permission }) =>
    fetchJson<TeamMember>(`/api/proxy/accounts/team/${userId}/grants`, {
      method: "POST",
      body: JSON.stringify({ permission }),
    })
  );
}

export function useRevokePermission() {
  return useTeamMutation<{ userId: number; permission: string }>(({ userId, permission }) =>
    fetchJson<TeamMember>(
      `/api/proxy/accounts/team/${userId}/grants?permission=${encodeURIComponent(permission)}`,
      { method: "DELETE" }
    )
  );
}
