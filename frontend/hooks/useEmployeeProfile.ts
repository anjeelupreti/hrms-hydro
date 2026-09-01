"use client";

import { useQuery } from "@tanstack/react-query";

import type { ProfileExperience } from "@/hooks/useProfile";

export type EmployeeProfile = {
  id: number;
  user_id: number;
  full_name: string;
  employee_code: string;
  email: string;
  role: string;
  phone: string;
  photo: string | null;
  cover_image: string | null;
  /** CSS `object-position` for the banner crop — see `Employee.cover_position`.
   *  Optional so an older backend simply falls back to the previous centring. */
  cover_position?: string;
  bio: string;
  address: string;
  city: string;
  country: string;
  skills: string[];
  date_joined: string;
  employment_status: string;
  department_name: string | null;
  designation_title: string | null;
  manager_name: string | null;
  manager_id: number | null;
  experiences: ProfileExperience[];
};

export function useEmployeeProfile(id: number | null) {
  return useQuery({
    queryKey: ["employee-profile", id],
    queryFn: async () => {
      const res = await fetch(`/api/proxy/employees/employees/${id}/profile`);
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json() as Promise<EmployeeProfile>;
    },
    enabled: id != null,
  });
}
