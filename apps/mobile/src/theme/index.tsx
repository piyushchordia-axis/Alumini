import { brandTones, DIM_PAGE_TEXT, pageBackdrop, pageInk, parseHex, type MemberAppearance, type PageBackdropSpec, type TenantPublicDto } from "@illuminize/shared";
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
  /**
   * What a page draws behind its content: the member's background at this institution inside the signed-in app
   * (pageBackdrop), the plain page everywhere else. Page shells take their colour from here, not from `colors.bg`.
   */
  page: PageBackdropSpec;
  /** Grey text written on the page itself, not in a card: `colors.muted`, one shade darker on a tint or a photo (`Muted` uses it). */
  pageMuted: string;
  /** The brand as text written on the page itself (a Filters toggle): the brand, darkened on a tint or a photo (pageInk). */
  pageInk: string;
}

type ThemeTenant = Pick<TenantPublicDto, "primaryColor" | "secondaryColor"> & Partial<Pick<TenantPublicDto, "coverImageUrl">>;

const DEFAULT_PRIMARY = "#1d4ed8";
const PLAIN_PAGE = pageBackdrop(null, null);

function soft(hex: string): string {
  const c = parseHex(hex) ?? parseHex(DEFAULT_PRIMARY)!;
  return `rgba(${c.r},${c.g},${c.b},0.12)`;
}

function build(primary: string, secondary: string, page: PageBackdropSpec): Theme {
  const tones = brandTones(primary);
  return {
    primary,
    secondary,
    primarySoft: soft(primary),
    primaryInk: tones.ink,
    primaryWash: tones.wash,
    primaryRing: tones.ring,
    onPrimary: tones.onPrimary,
    page,
    pageMuted: page.dimText ? DIM_PAGE_TEXT : colors.muted,
    pageInk: pageInk(primary, page),
  };
}

const DEFAULT: Theme = build(DEFAULT_PRIMARY, "#0f172a", PLAIN_PAGE);

/** The institution's theme; `appearance`, the member's own, gives its pages their background. */
export function themeFor(tenant?: ThemeTenant | null, appearance?: MemberAppearance | null): Theme {
  if (!tenant) return DEFAULT;
  const page = appearance ? pageBackdrop(appearance, { primaryColor: tenant.primaryColor, coverImageUrl: tenant.coverImageUrl ?? null }) : PLAIN_PAGE;
  return build(tenant.primaryColor, tenant.secondaryColor, page);
}

const ThemeContext = createContext<Theme>(DEFAULT);

export function ThemeProvider({ tenant, appearance, children }: { tenant?: ThemeTenant | null; appearance?: MemberAppearance | null; children: ReactNode }) {
  const value = useMemo(() => themeFor(tenant, appearance), [tenant, appearance]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Puts the plain page back under the member's background, for the admin console: the console, and any preview of the
 * institution's look in it, show the institution as everyone else sees it.
 */
export function PlainPage({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const value = useMemo(() => (theme.page === PLAIN_PAGE ? theme : build(theme.primary, theme.secondary, PLAIN_PAGE)), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
