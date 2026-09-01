import { create } from "zustand";

export type DrawerType = "reviewDrawer" | "expenseClaim" | null;

/** Whatever the opening call passes through to the drawer body. Open by
 *  design — each drawer narrows it to the shape it needs. */
export type DrawerProps = Record<string, unknown>;

interface ModalState {
  drawerType: DrawerType;
  drawerProps: DrawerProps;
  openDrawer: (type: DrawerType, props?: DrawerProps) => void;
  closeDrawer: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  drawerType: null,
  drawerProps: {},
  openDrawer: (type, props = {}) => set({ drawerType: type, drawerProps: props }),
  closeDrawer: () => set({ drawerType: null, drawerProps: {} }),
}));
