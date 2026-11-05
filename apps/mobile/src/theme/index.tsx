import { brandTones, parseHex, type TenantPublicDto } from "@illuminize/shared";
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
  /** The brand as text or a chosen icon, darkened if it's too light to read on white, the page or `primarySoft` (`brandTones`). */
  primaryInk: string;
  /** A light tint of the ink behind something chosen, such as the member's reaction. */
  primaryWash: string;
  /** The thin ring around `primaryWash`. */
  primaryRing: string;
  /** Text on the brand colour: white, or near-black on a light brand. */
  onPrimary: string;
}

const DEFAULT_PRIMARY = "#1d4ed8";

function soft(hex: string): string {
  const c = parseHex(hex) ?? parseHex(DEFAULT_PRIMARY)!;
  return `rgba(${c.r},${c.g},${c.b},0.12)`;
}

function build(primary: string, secondary: string): Theme {
  const tones = brandTones(primary);
  return {
    primary,
    secondary,
    primarySoft: soft(primary),
    primaryInk: tones.ink,
    primaryWash: tones.wash,
    primaryRing: tones.ring,
    onPrimary: tones.onPrimary,
  };
}

const DEFAULT: Theme = build(DEFAULT_PRIMARY, "#0f172a");

export function themeFor(tenant?: Pick<TenantPublicDto, "primaryColor" | "secondaryColor"> | null): Theme {
  if (!tenant) return DEFAULT;
  return build(tenant.primaryColor, tenant.secondaryColor);
}

const ThemeContext = createContext<Theme>(DEFAULT);

export function ThemeProvider({ tenant, children }: { tenant?: Pick<TenantPublicDto, "primaryColor" | "secondaryColor"> | null; children: ReactNode }) {
  const value = useMemo(() => themeFor(tenant), [tenant]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
