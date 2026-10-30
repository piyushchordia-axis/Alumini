import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { AppError } from "./errors";

export interface NormalizedPhone {
  e164: string;
  region: string | null;
}

/**
 * Normalises user input to E.164. Numbers without a country code are
 * interpreted in `defaultCountry` (India by default). Validation is
 * length/structure based (`isPossible`) so new number ranges are not rejected;
 * ownership is proven by the OTP itself.
 */
export function normalizePhone(raw: string, defaultCountry: CountryCode = "IN"): NormalizedPhone {
  const cleaned = raw.replace(/[\s().-]/g, "");
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed || !parsed.isPossible()) {
    throw AppError.badRequest("Enter a valid mobile number including the country code", [
      { path: "phone", message: "Invalid phone number" },
    ]);
  }
  return { e164: parsed.number, region: parsed.country ?? null };
}

export function maskPhone(e164: string): string {
  if (e164.length <= 6) return e164;
  return `${e164.slice(0, 3)}${"*".repeat(e164.length - 6)}${e164.slice(-3)}`;
}
