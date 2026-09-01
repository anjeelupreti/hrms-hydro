"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * The lists that hang off one person: who to call, who they support, what they
 * studied.
 *
 * All three endpoints take `?employee=` and default to the caller, so an
 * employee reaches their own without knowing their id — and HR reaches somebody
 * else's by passing one. Whether they *may* is decided by the server; passing
 * an id you have no claim to returns an empty list rather than a refusal.
 */

export type EmergencyContact = {
  id: number;
  name: string;
  relationship: string;
  phone: string;
  alternate_phone: string;
  address: string;
  is_primary: boolean;
};

export type Dependant = {
  id: number;
  name: string;
  relationship: string;
  date_of_birth: string | null;
  is_covered_by_insurance: boolean;
  note: string;
};

export type EducationRecord = {
  id: number;
  institution: string;
  qualification: string;
  field_of_study: string;
  start_year: number | null;
  end_year: number | null;
  grade: string;
  verified_at: string | null;
  verified_by_name: string | null;
  is_verified: boolean;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    // DRF field errors come back keyed; surface the first useful one rather
    // than a status code nobody can act on.
    const detail =
      body.detail ??
      Object.values(body)
        .flat()
        .find((v) => typeof v === "string");
    throw new Error(typeof detail === "string" ? detail : `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

function list<T>(payload: { results?: T[] } | T[]): T[] {
  return Array.isArray(payload) ? payload : (payload.results ?? []);
}

function query(employeeId?: number | null) {
  return employeeId ? `?employee=${employeeId}` : "";
}

function useRecordList<T>(kind: string, path: string, employeeId?: number | null) {
  return useQuery({
    queryKey: ["personal-records", kind, employeeId ?? "me"],
    queryFn: async () =>
      list<T>(await json<{ results?: T[] } | T[]>(`/api/proxy/employees/${path}${query(employeeId)}`)),
  });
}

function useSaveRecord<T>(kind: string, path: string, employeeId?: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<T> & { id?: number }) =>
      json<T>(
        values.id
          ? `/api/proxy/employees/${path}/${values.id}`
          : `/api/proxy/employees/${path}${query(employeeId)}`,
        {
          method: values.id ? "PATCH" : "POST",
          body: JSON.stringify({ ...values, employee: employeeId ?? undefined }),
        }
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personal-records", kind] }),
  });
}

function useDeleteRecord(kind: string, path: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      json<void>(`/api/proxy/employees/${path}/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personal-records", kind] }),
  });
}

export const useEmergencyContacts = (employeeId?: number | null) =>
  useRecordList<EmergencyContact>("contacts", "emergency-contacts", employeeId);
export const useSaveEmergencyContact = (employeeId?: number | null) =>
  useSaveRecord<EmergencyContact>("contacts", "emergency-contacts", employeeId);
export const useDeleteEmergencyContact = () =>
  useDeleteRecord("contacts", "emergency-contacts");

export const useDependants = (employeeId?: number | null) =>
  useRecordList<Dependant>("dependants", "dependants", employeeId);
export const useSaveDependant = (employeeId?: number | null) =>
  useSaveRecord<Dependant>("dependants", "dependants", employeeId);
export const useDeleteDependant = () => useDeleteRecord("dependants", "dependants");

export const useEducation = (employeeId?: number | null) =>
  useRecordList<EducationRecord>("education", "education", employeeId);
export const useSaveEducation = (employeeId?: number | null) =>
  useSaveRecord<EducationRecord>("education", "education", employeeId);
export const useDeleteEducation = () => useDeleteRecord("education", "education");

/** HR has seen the certificate. Its own call because verification is a claim
 *  *about* a record made by somebody other than its subject. */
export function useVerifyEducation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, verified }: { id: number; verified: boolean }) =>
      json<EducationRecord>(
        `/api/proxy/employees/education/${id}/${verified ? "verify" : "unverify"}`,
        { method: "POST" }
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personal-records", "education"] }),
  });
}
