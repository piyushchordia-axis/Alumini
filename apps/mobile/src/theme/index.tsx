import type { TenantPublicDto } from "@illuminize/shared";
import { createContext, useContext, useMemo, type ReactNode } from "react";

export const colors = {
  bg: "#f1f5f9",
  card: "#ffffff",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  text: "#0f172a",
  muted: "#64748b",
  faint: "#94a3b8",
  danger: "#dc2626",
  success: "#059669",
  warning: "#d97706",
  info: "#0284c7",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 12, lg: 16, full: 999 };
export const elevation = {
  1: {
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#0f172a",
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  2: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    shadowColor: "#0f172a",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
} as const;

export interface Theme {
  primary: string;
  secondary: string;
  primarySoft: string;
}

const DEFAULT: Theme = { primary: "#1d4ed8", secondary: "#0f172a", primarySoft: "rgba(29,78,216,0.12)" };

function soft(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return DEFAULT.primarySoft;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.12)`;
}

export function themeFor(tenant?: Pick<TenantPublicDto, "primaryColor" | "secondaryColor"> | null): Theme {
  if (!tenant) return DEFAULT;
  return { primary: tenant.primaryColor, secondary: tenant.secondaryColor, primarySoft: soft(tenant.primaryColor) };
}

const ThemeContext = createContext<Theme>(DEFAULT);

export function ThemeProvider({ tenant, children }: { tenant?: Pick<TenantPublicDto, "primaryColor" | "secondaryColor"> | null; children: ReactNode }) {
  const value = useMemo(() => themeFor(tenant), [tenant]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
