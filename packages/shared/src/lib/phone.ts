import { countryByCode } from "../constants";

const DEFAULT_MAX_NATIONAL_DIGITS = 15;

/** Max national significant digits for a country ISO code (India is 10). */
export function maxNationalDigits(country: string | null | undefined): number {
  return countryByCode(country)?.maxNationalDigits ?? DEFAULT_MAX_NATIONAL_DIGITS;
}

/**
 * Keeps digits, spaces and hyphens for display, but caps the digit count at the country's max national length.
 * Use on every national-number field change and when the country code changes.
 */
export function clampNationalNumber(country: string, raw: string): string {
  const max = maxNationalDigits(country);
  let digits = 0;
  let out = "";
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      if (digits >= max) continue;
      digits += 1;
      out += ch;
    } else if (ch === " " || ch === "-") {
      out += ch;
    }
  }
  return out;
}
