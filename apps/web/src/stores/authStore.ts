import type { AuthSessionDto, MembershipSummaryDto, UserDto } from "@illuminize/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserDto | null;
  memberships: MembershipSummaryDto[];
  setSession: (session: AuthSessionDto) => void;
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  setUser: (user: UserDto, memberships: MembershipSummaryDto[]) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      memberships: [],
      setSession: (s) => set({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user, memberships: s.memberships }),
      setTokens: (t) => set({ accessToken: t.accessToken, refreshToken: t.refreshToken }),
      setUser: (user, memberships) => set({ user, memberships }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null, memberships: [] }),
    }),
    { name: "illuminize.auth" },
  ),
);

export const useIsAuthenticated = () => useAuthStore((s) => !!s.accessToken);
