import { create } from "zustand";

type UIState = {
  /** Mobile navigation drawer. Transient, so it stays here rather than in the
   * persisted appearance store — nobody wants to reload into an open drawer. */
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;

  /** ⌘K command palette. Global, because the shortcut is global. */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  /** Floating chat widget open state + which conversation it's showing.
   * Lifted out of the widget so other surfaces (e.g. the right-rail
   * avatars) can open a DM directly. */
  chatOpen: boolean;
  chatSelectedId: number | null;
  setChatOpen: (open: boolean) => void;
  setChatSelectedId: (id: number | null) => void;
  openChatConversation: (conversationId: number) => void;

  /** Global slide-out drawer for Employee Profiles */
  profileDrawerOpen: boolean;
  profileDrawerEmployeeId: number | null;
  openEmployeeProfile: (employeeId: number) => void;
  closeEmployeeProfile: () => void;
};

// Sidebar *behaviour* deliberately does not live here: it is an appearance
// preference and belongs in the persisted theme store next to colour mode,
// accent and density.
export const useUIStore = create<UIState>((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  chatOpen: false,
  chatSelectedId: null,
  setChatOpen: (open) => set({ chatOpen: open }),
  setChatSelectedId: (id) => set({ chatSelectedId: id }),
  openChatConversation: (conversationId) => set({ chatOpen: true, chatSelectedId: conversationId }),

  profileDrawerOpen: false,
  profileDrawerEmployeeId: null,
  openEmployeeProfile: (employeeId) => set({ profileDrawerOpen: true, profileDrawerEmployeeId: employeeId }),
  closeEmployeeProfile: () => set({ profileDrawerOpen: false, profileDrawerEmployeeId: null }),
}));
