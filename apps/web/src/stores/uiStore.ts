import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  lastTenantSlug: string | null;
  setLastTenantSlug: (slug: string | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      lastTenantSlug: null,
      setLastTenantSlug: (slug) => set({ lastTenantSlug: slug }),
    }),
    { name: "illuminize.ui" },
  ),
);

interface Toast {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: Toast["tone"]) => void;
  dismiss: (id: number) => void;
}

let toastId = 0;
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (message, tone = "info") => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (m: string) => useToastStore.getState().push(m, "success"),
  error: (m: string) => useToastStore.getState().push(m, "error"),
  info: (m: string) => useToastStore.getState().push(m, "info"),
};
