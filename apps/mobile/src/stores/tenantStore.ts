import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface TenantState {
  lastTenantSlug: string | null;
  setLastTenantSlug: (slug: string | null) => void;
}

export const useTenantStore = create<TenantState>()(
  persist((set) => ({ lastTenantSlug: null, setLastTenantSlug: (slug) => set({ lastTenantSlug: slug }) }), {
    name: "illuminize.tenant",
    storage: createJSONStorage(() => AsyncStorage),
  }),
);
