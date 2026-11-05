import { brandTones, parseHex, type TenantSummaryDto } from "@illuminize/shared";

const DEFAULT_PRIMARY = "#1d4ed8";
const DEFAULT_SECONDARY = "#0f172a";

function hexToRgbTriplet(hex: string): string {
  const c = parseHex(hex) ?? parseHex(DEFAULT_PRIMARY)!;
  return `${c.r} ${c.g} ${c.b}`;
}

/**
 * Applies a tenant's colours to the CSS variables consumed by Tailwind's `primary`/`secondary` colours, and the tones
 * derived from the primary (`brandTones`): `primary-ink` (the brand as text or a chosen icon, darkened if it's too light
 * to read), `primary-wash` and `primary-ring` (behind and around something chosen) and `on-primary` (text on the brand
 * colour).
 */
export function applyTenantTheme(tenant?: Pick<TenantSummaryDto, "primaryColor"> & { secondaryColor?: string }): void {
  const root = document.documentElement;
  const primary = tenant?.primaryColor ?? DEFAULT_PRIMARY;
  const tones = brandTones(primary);
  root.style.setProperty("--c-primary", hexToRgbTriplet(primary));
  root.style.setProperty("--c-primary-ink", hexToRgbTriplet(tones.ink));
  root.style.setProperty("--c-primary-wash", hexToRgbTriplet(tones.wash));
  root.style.setProperty("--c-primary-ring", hexToRgbTriplet(tones.ring));
  root.style.setProperty("--c-on-primary", hexToRgbTriplet(tones.onPrimary));
  root.style.setProperty("--c-secondary", hexToRgbTriplet(tenant?.secondaryColor ?? DEFAULT_SECONDARY));
}

export function resetTheme(): void {
  applyTenantTheme();
}
