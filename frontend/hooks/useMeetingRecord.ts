"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchJson } from "@/lib/query/fetchJson";
import type {
  AgendaItem,
  Meeting,
  MeetingDecision,
  MeetingMinutes,
} from "@/types/meetings";

/**
 * Everything a meeting produces, as opposed to the meeting itself.
 *
 * `useCalendar` owns the calendar side — listing meetings, creating one,
 * RSVPing. This owns the record: the agenda, the register, the decisions and
 * the minute. Kept separate because they are read by different screens and on
 * different occasions; a calendar does not want the decision positions of
 * every meeting it lists.
 */

const BASE = "/api/proxy/notifications/meetings";

function useInvalidate() {
  const queryClient = useQueryClient();
  return (id: number) => {
    // The meeting itself carries the attendee rows and the derived duration,
    // so anything here can change it.
    queryClient.invalidateQueries({ queryKey: ["meetings"] });
    queryClient.invalidateQueries({ queryKey: ["meeting", id] });
    queryClient.invalidateQueries({ queryKey: ["company-events"] });
  };
}

/** One meeting, with its attendees — the detail view's own read. */
export function useMeeting(id: number | null) {
  return useQuery({
    queryKey: ["meeting", id],
    queryFn: () => fetchJson<Meeting>(`${BASE}/${id}`),
    enabled: id !== null,
  });
}

export function useUpdateMeeting() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<Meeting> }) =>
      fetchJson<Meeting>(`${BASE}/${id}/`, { method: "PATCH", body: JSON.stringify(values) }),
    onSuccess: (meeting) => invalidate(meeting.id),
  });
}

// ── The agenda ─────────────────────────────────────────────────────────

export function useAgenda(meetingId: number | null) {
  return useQuery({
    queryKey: ["meeting", meetingId, "agenda"],
    queryFn: () => fetchJson<AgendaItem[]>(`${BASE}/${meetingId}/agenda/`),
    enabled: meetingId !== null,
  });
}

function useAgendaInvalidate() {
  const queryClient = useQueryClient();
  return (meetingId: number) =>
    queryClient.invalidateQueries({ queryKey: ["meeting", meetingId, "agenda"] });
}

export function useAddAgendaItem() {
  const invalidate = useAgendaInvalidate();
  return useMutation({
    mutationFn: ({
      meetingId,
      values,
    }: {
      meetingId: number;
      values: { title: string; detail?: string; raised_in_meeting?: boolean };
    }) => fetchJson<AgendaItem>(`${BASE}/${meetingId}/agenda/`, {
      method: "POST",
      body: JSON.stringify(values),
    }),
    onSuccess: (_item, { meetingId }) => invalidate(meetingId),
  });
}

export function useEditAgendaItem() {
  const invalidate = useAgendaInvalidate();
  return useMutation({
    mutationFn: ({
      meetingId,
      itemId,
      values,
    }: {
      meetingId: number;
      itemId: number;
      values: Partial<AgendaItem>;
    }) => fetchJson<AgendaItem>(`${BASE}/${meetingId}/agenda/${itemId}/`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
    onSuccess: (_item, { meetingId }) => invalidate(meetingId),
  });
}

export function useRemoveAgendaItem() {
  const invalidate = useAgendaInvalidate();
  return useMutation({
    mutationFn: ({ meetingId, itemId }: { meetingId: number; itemId: number }) =>
      fetchJson<void>(`${BASE}/${meetingId}/agenda/${itemId}/`, { method: "DELETE" }),
    onSuccess: (_void, { meetingId }) => invalidate(meetingId),
  });
}

// ── The register ───────────────────────────────────────────────────────

/**
 * Mark who came.
 *
 * Anybody not named is left as they were, so marking one late arrival does not
 * blank everybody else — see the endpoint.
 */
export function useMarkAttendance() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      meetingId,
      present,
      absent,
    }: {
      meetingId: number;
      present?: number[];
      absent?: number[];
    }) => fetchJson<Meeting>(`${BASE}/${meetingId}/attendance/`, {
      method: "POST",
      body: JSON.stringify({ present: present ?? [], absent: absent ?? [] }),
    }),
    onSuccess: (meeting) => invalidate(meeting.id),
  });
}

// ── Decisions ──────────────────────────────────────────────────────────

export function useDecisions(meetingId: number | null) {
  return useQuery({
    queryKey: ["meeting", meetingId, "decisions"],
    queryFn: () => fetchJson<MeetingDecision[]>(`${BASE}/${meetingId}/decisions/`),
    enabled: meetingId !== null,
  });
}

function useDecisionsInvalidate() {
  const queryClient = useQueryClient();
  return (meetingId: number) => {
    queryClient.invalidateQueries({ queryKey: ["meeting", meetingId, "decisions"] });
    // The minute draws the consent register live, so it changes too.
    queryClient.invalidateQueries({ queryKey: ["meeting", meetingId, "minutes"] });
  };
}

export function useAddDecision() {
  const invalidate = useDecisionsInvalidate();
  return useMutation({
    mutationFn: ({
      meetingId,
      text,
      agendaItem,
    }: {
      meetingId: number;
      text: string;
      agendaItem?: number | null;
    }) => fetchJson<MeetingDecision>(`${BASE}/${meetingId}/decisions/`, {
      method: "POST",
      body: JSON.stringify({ text, agenda_item: agendaItem ?? null }),
    }),
    onSuccess: (_d, { meetingId }) => invalidate(meetingId),
  });
}

export function useCirculateDecision() {
  const invalidate = useDecisionsInvalidate();
  return useMutation({
    mutationFn: ({ meetingId, decisionId }: { meetingId: number; decisionId: number }) =>
      fetchJson<MeetingDecision>(`${BASE}/${meetingId}/decisions/${decisionId}/circulate/`, {
        method: "POST",
      }),
    onSuccess: (_d, { meetingId }) => invalidate(meetingId),
  });
}

export function useRespondToDecision() {
  const invalidate = useDecisionsInvalidate();
  return useMutation({
    mutationFn: ({
      meetingId,
      decisionId,
      position,
      reason,
    }: {
      meetingId: number;
      decisionId: number;
      position: "consent" | "dissent" | "abstain";
      reason?: string;
    }) => fetchJson<MeetingDecision>(`${BASE}/${meetingId}/decisions/${decisionId}/respond/`, {
      method: "POST",
      body: JSON.stringify({ position, reason: reason ?? "" }),
    }),
    onSuccess: (_d, { meetingId }) => invalidate(meetingId),
  });
}

// ── The minute ─────────────────────────────────────────────────────────

export function useMinutes(meetingId: number | null) {
  return useQuery({
    queryKey: ["meeting", meetingId, "minutes"],
    queryFn: async () => {
      try {
        return await fetchJson<MeetingMinutes>(`${BASE}/${meetingId}/minutes/`);
      } catch {
        // 404 until somebody drafts one. Absence is the normal state, not an
        // error, so it comes back as null rather than throwing into the UI.
        return null;
      }
    },
    enabled: meetingId !== null,
  });
}

function useMinutesInvalidate() {
  const queryClient = useQueryClient();
  return (meetingId: number) =>
    queryClient.invalidateQueries({ queryKey: ["meeting", meetingId, "minutes"] });
}

/** Draft it from the template, the register and the decisions. */
export function useDraftMinutes() {
  const invalidate = useMinutesInvalidate();
  return useMutation({
    mutationFn: (meetingId: number) =>
      fetchJson<MeetingMinutes>(`${BASE}/${meetingId}/minutes/`, { method: "POST" }),
    onSuccess: (_m, meetingId) => invalidate(meetingId),
  });
}

export function useSaveMinutes() {
  const invalidate = useMinutesInvalidate();
  return useMutation({
    mutationFn: ({ meetingId, content }: { meetingId: number; content: string }) =>
      fetchJson<MeetingMinutes>(`${BASE}/${meetingId}/minutes/`, {
        method: "PATCH",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (_m, { meetingId }) => invalidate(meetingId),
  });
}

export function useFinaliseMinutes() {
  const invalidate = useMinutesInvalidate();
  return useMutation({
    mutationFn: (meetingId: number) =>
      fetchJson<MeetingMinutes>(`${BASE}/${meetingId}/minutes/finalise/`, { method: "POST" }),
    onSuccess: (_m, meetingId) => invalidate(meetingId),
  });
}
