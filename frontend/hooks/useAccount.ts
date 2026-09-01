"use client";

import { useMutation } from "@tanstack/react-query";

export function useChangePassword() {
  return useMutation({
    mutationFn: async (values: { old_password: string; new_password: string }) => {
      const res = await fetch("/api/proxy/accounts/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // DRF field errors come back keyed; surface the first useful one.
        const msg =
          data.detail ??
          data.old_password?.[0] ??
          data.new_password?.[0] ??
          `Request failed (${res.status})`;
        throw new Error(msg);
      }
      return res.json() as Promise<{ detail: string }>;
    },
  });
}
