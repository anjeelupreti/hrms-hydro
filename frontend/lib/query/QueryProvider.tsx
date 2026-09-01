"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { useToastStore } from "@/lib/store/toast";

export default function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Perf: without these, every query is stale immediately and refetches
        // on every mount + window focus — with ~5 shell components calling
        // useMe and pages mounting many hooks, that's a lot of redundant
        // round-trips. 30s staleTime + no refetch-on-focus removes most of it.
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
        // Global feedback: every failed mutation raises an error toast, and
        // any mutation with meta.successMessage raises a success toast — so
        // pages get consistent alerts without wiring each call site.
        mutationCache: new MutationCache({
          onError: (error) => {
            useToastStore
              .getState()
              .show(error instanceof Error ? error.message : "Something went wrong.", "error");
          },
          onSuccess: (_data, _vars, _ctx, mutation) => {
            const msg = mutation.meta?.successMessage;
            if (msg) useToastStore.getState().show(String(msg), "success");
          },
        }),
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
