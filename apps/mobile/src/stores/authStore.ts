import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuthSessionDto, MembershipSummaryDto, UserDto } from "@illuminize/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface AuthState {
  /** True once a session exists (tokens are stored separately in SecureStore). */
  isAuthenticated: boolean;
  user: UserDto | null;
  memberships: MembershipSummaryDto[];
  hydrated: boolean;
  setSession: (s: AuthSessionDto) => void;
  setUser: (user: UserDto, memberships: MembershipSummaryDto[]) => void;
  clear: () => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      user: null,
      memberships: [],
      hydrated: false,
      setSession: (s) => set({ isAuthenticated: true, user: s.user, memberships: s.memberships }),
      setUser: (user, memberships) => set({ isAuthenticated: true, user, memberships }),
      clear: () => set({ isAuthenticated: false, user: null, memberships: [] }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "illuminize.auth",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ isAuthenticated: s.isAuthenticated, user: s.user, memberships: s.memberships }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
