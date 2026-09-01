import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Whether money is hidden on screen.
 *
 * **Why default to hidden.** Payroll is opened in the places privacy is
 * hardest: a shared desk, a screen share, a laptop on a table in an office.
 * Somebody who wants to see a figure can reveal it in one click, and somebody
 * who did not want it seen has no way to un-see it. The asymmetry decides the
 * default.
 *
 * **Why a preference rather than a permission.** This is not access control —
 * anyone who can open a payslip can reveal its figures, and the API is
 * unchanged. It exists to stop numbers being read by people standing behind
 * you, which is a different problem from stopping them being fetched.
 * Confusing the two would be worse than either: a mask that looked like
 * security would invite somebody to rely on it.
 *
 * Persisted, so the system where salaries are routinely on a projector can
 * turn it on once.
 */
type PrivacyState = {
  amountsHidden: boolean;
  setAmountsHidden: (hidden: boolean) => void;
  toggleAmounts: () => void;
};

export const usePrivacyStore = create<PrivacyState>()(
  persist(
    (set) => ({
      amountsHidden: true,
      setAmountsHidden: (hidden) => set({ amountsHidden: hidden }),
      toggleAmounts: () => set((state) => ({ amountsHidden: !state.amountsHidden })),
    }),
    { name: "hrms-privacy" }
  )
);

/**
 * `amountsHidden`, safe to read during a server render.
 *
 * **Why not just `usePrivacyStore(s => s.amountsHidden)`.** `persist` rehydrates
 * from `localStorage` synchronously as the store is created, so on the client
 * the very first render can already hold `false` while the server rendered
 * `true` — a hydration mismatch, and one that resolves by painting every salary
 * on the page for a frame. Which is the exact thing masking exists to prevent.
 *
 * `useSyncExternalStore` is given a server snapshot that is always `true`, so
 * SSR and the hydration render agree on *masked*, and React swaps to the real
 * preference immediately afterwards. Erring towards hidden is the safe
 * direction: a figure shown for a frame cannot be un-seen, and a figure hidden
 * for a frame costs nothing.
 */
export function useAmountsHidden(): boolean {
  return useSyncExternalStore(
    usePrivacyStore.subscribe,
    () => usePrivacyStore.getState().amountsHidden,
    () => true
  );
}
