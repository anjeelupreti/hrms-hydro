"use client";

import { useQuery } from "@tanstack/react-query";

import type { DashboardSummary } from "@/types/dashboard";

export function useDashboardSummary() {
  return useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: async () => {
      const response = await fetch("/api/proxy/dashboard/summary");
      if (!response.ok) throw new Error("Failed to load dashboard summary");
      return response.json() as Promise<DashboardSummary>;
    },
  });
}
