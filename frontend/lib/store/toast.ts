import { create } from "zustand";

export type ToastSeverity = "success" | "error" | "info" | "warning";

type ToastState = {
  open: boolean;
  message: string;
  severity: ToastSeverity;
  show: (message: string, severity?: ToastSeverity) => void;
  hide: () => void;
};

/** App-wide toast/snackbar. Call `useToastStore.getState().show(...)` from
 * anywhere (incl. non-React code like the react-query MutationCache). */
export const useToastStore = create<ToastState>((set) => ({
  open: false,
  message: "",
  severity: "success",
  show: (message, severity = "success") => set({ open: true, message, severity }),
  hide: () => set({ open: false }),
}));

export const toast = (message: string, severity: ToastSeverity = "success") =>
  useToastStore.getState().show(message, severity);
