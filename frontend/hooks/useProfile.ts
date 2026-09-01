"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/query/fetchJson";

export type ProfileExperience = {
  id: number;
  title: string;
  company: string;
  start_year: number | null;
  end_year: number | null;
  description: string;
};

export type ProfileActivity = {
  id: number;
  field: string;
  from_value: string | null;
  to_value: string | null;
  actor: string | null;
  created_at: string;
};

export type MyProfile = {
  username: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  date_of_birth: string | null;
  gender: string;
  photo: string | null;
  cover_image: string | null;
  /** CSS `object-position` for the banner crop. `"50% 50%"` is the old
   *  hardcoded behaviour, so an untouched cover looks exactly as it did. */
  cover_position?: string;
  resume: string | null;
  bio: string;
  address: string;
  city: string;
  country: string;
  skills: string[];
  experiences: ProfileExperience[];
  activity: ProfileActivity[];
  employee_code: string;
  date_joined: string;
  employment_status: string;
  department_name: string | null;
  designation_title: string | null;
  manager_name: string | null;
  probation_end_date: string | null;

  /**
   * The record *about* you — served read-only.
   *
   * These are not "not editable": they go through `EmployeeChangeRequest`,
   * because a bank account changed quietly the day before payroll is exactly
   * the loss that flow exists to prevent. Shown beside a way to request a
   * correction, which is the whole point — you cannot check a number you
   * cannot see, and a wrong one here is a salary paid to a stranger.
   */
  legal_first_name: string;
  legal_middle_name: string;
  legal_last_name: string;
  marital_status: string;
  citizenship_number: string;
  /** Whether a scan is on file. The file itself is fetched through Documents,
   *  which applies its own visibility rules and writes an access log. */
  citizenship_front_on_file: boolean;
  citizenship_back_on_file: boolean;
  passport_number: string;
  passport_expiry: string | null;

  pan_number: string;
  ssf_number: string;
  pf_number: string;
  cit_number: string;
  tax_election: string;

  bank_name: string;
  bank_branch: string;
  bank_account_name: string;
  /** Masked to the last four, even from its owner — the full number is only
   *  needed to build a payment file, which is a server-side job. */
  bank_account_number: string;
  bank_account_type: string;
};


export function useMyProfile(enabled = true) {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => fetchJson<MyProfile>("/api/proxy/accounts/profile"),
    enabled,
    retry: false,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    // FormData so photo/cover uploads ride in the same request; skills is
    // appended as a JSON string. Never set Content-Type — the browser adds
    // the multipart boundary.
    mutationFn: (form: FormData) => fetchJson<MyProfile>("/api/proxy/accounts/profile", { method: "PATCH", body: form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useAddExperience() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: Omit<ProfileExperience, "id">) =>
      fetchJson<ProfileExperience>("/api/proxy/accounts/experiences", {
        method: "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });
}

export function useDeleteExperience() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<void>(`/api/proxy/accounts/experiences/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile"] }),
  });
}
