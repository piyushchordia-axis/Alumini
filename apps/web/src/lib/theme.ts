import type { TenantSummaryDto } from "@illuminize/shared";

const DEFAULT_PRIMARY = "#1d4ed8";
const DEFAULT_SECONDARY = "#0f172a";

function hexToRgbTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hexToRgbTriplet(DEFAULT_PRIMARY);
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Applies a tenant's colours to the CSS variables consumed by Tailwind's `primary`/`secondary` colours. */
export function applyTenantTheme(tenant?: Pick<TenantSummaryDto, "primaryColor"> & { secondaryColor?: string }): void {
  const root = document.documentElement;
  root.style.setProperty("--c-primary", hexToRgbTriplet(tenant?.primaryColor ?? DEFAULT_PRIMARY));
  root.style.setProperty("--c-secondary", hexToRgbTriplet(tenant?.secondaryColor ?? DEFAULT_SECONDARY));
}

export function resetTheme(): void {
  applyTenantTheme();
}
