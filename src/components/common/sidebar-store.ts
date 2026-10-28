import { create } from "zustand";

/** État du menu latéral sur mobile (partagé entre le bouton de l'en-tête et le menu). */
export interface SidebarState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

/** Store global du menu latéral. */
export const useSidebarStore = create<SidebarState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
