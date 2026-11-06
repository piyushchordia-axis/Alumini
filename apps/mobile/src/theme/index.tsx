import { brandTones, DIM_PAGE_TEXT, GREYS, pageBackdrop, pageInk, parseHex, PLAIN_PAGE_COLOR, type MemberAppearance, type PageBackdropSpec, type TenantPublicDto } from "@illuminize/shared";
import { createContext, useContext, useMemo, type ReactNode } from "react";

/** The plain colours. The greys are the shared ones (GREYS), each with its job: see lib/tones.ts. */
export const colors = {
  bg: PLAIN_PAGE_COLOR,
  card: "#ffffff",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  text: GREYS.text,
  /** Excerpts, and grey text on a tinted surface (an unread row, a tray). Not the institution's secondary colour (`Theme.secondary`). */
  secondary: GREYS.secondary,
  /** Grey text: times, places, counts, bylines, hints and placeholders. On the page itself, `theme.pageMuted` (`Muted`). */
  muted: GREYS.meta,
  /** Icons, borders and tag edges, never text. */
  faint: GREYS.faint,
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
  /** The brand as a line, such as a brand tag's edge: 3:1 on white and the plain page, not always on a member's tinted `page`. */
  primaryEdge: string;
  /** The brand's soft tint as a solid colour, which the page doesn't show through: `primaryInk` reads on it at 4.5:1. */
  primaryTint: string;
  /** Text on the brand colour: white, or near-black on a light brand. */
  onPrimary: string;
  /**
   * What a page draws behind its content: the member's background at this institution inside the signed-in app
   * (pageBackdrop), the plain page everywhere else. Page shells take their colour from here, not from `colors.bg`.
   */
  page: PageBackdropSpec;
  /** Grey text written on the page itself, not in a card: `colors.muted`, one shade darker on a tint or a photo (`Muted` uses it). */
  pageMuted: string;
  /** The brand as text written on the page itself (a Filters toggle): the ink, darkened where the page or a current link's wash needs it (pageInk). */
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
    primaryEdge: tones.edge,
    primaryTint: tones.tint,
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
