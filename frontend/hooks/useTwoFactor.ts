"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/apiError";

export type TwoFactorStatus = { enabled: boolean; backup_codes_remaining: number };
export type TwoFactorSetup = { secret: string; otpauth_uri: string; qr: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(apiErrorMessage(data, res.status));
  }
  return res.json();
}

const B = "/api/proxy/accounts/2fa";

export function useTwoFactorStatus() {
  return useQuery({ queryKey: ["2fa"], queryFn: () => fetchJson<TwoFactorStatus>(B) });
}

export function useTwoFactorSetup() {
  return useMutation({ mutationFn: () => fetchJson<TwoFactorSetup>(`${B}/setup/`, { method: "POST" }) });
}

export function useTwoFactorEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      fetchJson<{ enabled: boolean; backup_codes: string[] }>(`${B}/enable/`, {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    meta: { successMessage: "Two-factor authentication enabled" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["2fa"] }),
  });
}

export function useTwoFactorDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      fetchJson<{ enabled: boolean }>(`${B}/disable/`, {
        method: "POST",
        body: JSON.stringify({ code }),
      }),
    meta: { successMessage: "Two-factor authentication disabled" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["2fa"] }),
  });
}
