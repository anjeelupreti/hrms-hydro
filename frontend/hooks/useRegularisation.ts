"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiErrorMessage } from "@/lib/apiError";
import type { PaginatedResponse } from "@/types/organization";

/**
 * Attendance disputes — an employee reporting that their record is wrong.
 *
 * **The backend has had this the whole time and nothing reached it.**
 * `RegularisationRequest` models the dispute, the reason and the decision, with
 * approve, reject and cancel actions and a rule that a pending request never
 * touches the attendance log. Not one frontend surface referenced it, so an
 * employee whose badge failed still had to ask somebody in person — which is
 * the exact situation the model was written to replace.
 */

export type RegularisationStatus = "pending" | "approved" | "rejected" | "cancelled";

export type RegularisationRequest = {
  id: number;
  employee: number;
  employee_code: string;
  employee_name: string;
  /** The day being disputed. Often a day with *no* log at all — a missed
   *  punch — which is why it is a date rather than a link to a record. */
  date: string;
  requested_check_in: string | null;
  requested_check_out: string | null;
  requested_status: string;
  reason: string;
  status: RegularisationStatus;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string;
  created_at: string;
};

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

export function useRegularisations(filters: { employee?: number; status?: string } = {}) {
  const params = new URLSearchParams({ page_size: "100" });
  if (filters.employee) params.set("employee", String(filters.employee));
  if (filters.status) params.set("status", filters.status);

  return useQuery({
    queryKey: ["attendance", "regularisations", filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<RegularisationRequest>>(
        `/api/proxy/attendance/regularisations?${params.toString()}`
      ),
    placeholderData: (previous) => previous,
  });
}

export type RegularisationDraft = {
  date: string;
  reason: string;
  requested_check_in?: string | null;
  requested_check_out?: string | null;
  requested_status?: string;
};

function useRegularisationMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

export function useRaiseRegularisation() {
  return useRegularisationMutation<RegularisationDraft>((draft) =>
    fetchJson("/api/proxy/attendance/regularisations", {
      method: "POST",
      body: JSON.stringify(draft),
    })
  );
}

/** Approve, reject or withdraw. One shape, because they are one workflow and
 *  three separate hooks would drift in what they invalidate. */
export function useDecideRegularisation() {
  return useRegularisationMutation<{
    id: number;
    action: "approve" | "reject" | "cancel";
    review_note?: string;
  }>(({ id, action, review_note }) =>
    fetchJson(`/api/proxy/attendance/regularisations/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify(review_note ? { review_note } : {}),
    })
  );
}
