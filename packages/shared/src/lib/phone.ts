import { AsYouType, Metadata, getCountryCallingCode, isSupportedCountry, parsePhoneNumberFromString } from "libphonenumber-js/min";
import { COUNTRIES, countryByCode } from "../constants";

const DEFAULT_MAX_NATIONAL_DIGITS = 15;

/** Max national significant digits for a country ISO code (India is 10). */
export function maxNationalDigits(country: string | null | undefined): number {
  return countryByCode(country)?.maxNationalDigits ?? DEFAULT_MAX_NATIONAL_DIGITS;
}

/** Keeps digits, spaces and hyphens, and the first `max` digits. */
function keepDigits(raw: string, max: number): string {
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

/**
 * Keeps digits, spaces and hyphens for display, but caps the digit count at the country's max national length.
 * It is the last step of `readPhoneEntry`, which a phone field uses; on its own it would read "+919876543210" as the
 * national number "9198765432".
 */
export function clampNationalNumber(country: string, raw: string): string {
  return keepDigits(raw, maxNationalDigits(country));
}

/** A phone field: the country picker and the number box beside it. */
export interface PhoneEntry {
  /** ISO country code; the calling code comes from it (US and CA both dial +1 but stay distinct). */
  country: string;
  /** What the box shows: the national number as typed (digits, spaces, hyphens), or "+9" / "00" while a calling code is still being typed. */
  number: string;
  /**
   * Set while a calling code is typed in front of a number already in the box ("+9" before "98765 43210"): that number,
   * which stays the national part once the code is whole. A country picked meanwhile reads this, not the box.
   */
  held?: string;
}

const CALLING_CODES = new Set(COUNTRIES.map((c) => c.dial.slice(1)));

/**
 * The main country of each calling code several countries share. libphonenumber knows it but doesn't expose it in its
 * documented API, so it is written out here, and a unit test checks it against libphonenumber's metadata.
 */
const MAIN_COUNTRY_BY_CALLING_CODE: Readonly<Record<string, string>> = {
  "1": "US",
  "7": "RU",
  "39": "IT",
  "44": "GB",
  "47": "NO",
  "61": "AU",
  "212": "MA",
  "262": "RE",
  "290": "SH",
  "358": "FI",
  "590": "GP",
  "599": "CW",
};

const digitsOf = (text: string) => text.replace(/\D/g, "");
const trimLead = (text: string) => text.replace(/^[ -]+/, "");

/**
 * A copied number as if it had been typed. WhatsApp and the iPhone's Contacts wrap one in invisible direction marks
 * (U+202A to U+202E), and some keyboards give a fullwidth plus (U+FF0B), no-break spaces or typographic dashes.
 */
function plainText(raw: string): string {
  return raw
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/\uFF0B/g, "+")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-");
}

/** A "+" before the first digit, whatever comes ahead of it ("(+44) 7700…", "tel:+44…"). */
const startsInternational = (text: string) => /^\D*\+/.test(text);

/** Splits `text` just after its `count`th digit. */
function splitAfterDigits(text: string, count: number): [string, string] {
  if (count <= 0) return ["", text];
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch >= "0" && ch <= "9" && ++seen === count) return [text.slice(0, i + 1), text.slice(i + 1)];
  }
  return [text, ""];
}

/** Calling codes are prefix-free, so the first one `digits` starts with is the one. */
function leadingCallingCode(digits: string): string | undefined {
  for (let n = 1; n <= Math.min(3, digits.length); n++) {
    const code = digits.slice(0, n);
    if (CALLING_CODES.has(code)) return code;
  }
  return undefined;
}

/** How many leading digits are the country's international prefix ("00" from India, "011" from the US). */
function internationalPrefixLength(country: string, digits: string): number {
  if (!digits || !isSupportedCountry(country)) return 0;
  const metadata = new Metadata();
  metadata.selectNumberingPlan(country);
  const prefix = metadata.numberingPlan?.IDDPrefix();
  return (prefix ? new RegExp(`^(?:${prefix})`).exec(digits)?.[0].length : undefined) ?? 0;
}

/**
 * The national significant number libphonenumber reads from digits typed without a calling code: without a trunk
 * prefix ("0" in India, "1" in the US) or carrier code. Undefined when it reads them as a calling code instead.
 */
function nationalSignificant(country: string, digits: string): string | undefined {
  if (!digits) return "";
  if (!isSupportedCountry(country)) return undefined;
  const typing = new AsYouType(country);
  typing.input(digits);
  const value = typing.isInternational() ? undefined : typing.getNumberValue();
  const code = `+${getCountryCallingCode(country)}`;
  return value?.startsWith(code) ? value.slice(code.length) : undefined;
}

/**
 * How many typed digits libphonenumber leaves out of the national number: a trunk prefix ("0" in India, "8" in Russia),
 * a carrier code, or the "0" and "15" an Argentine mobile is dialled with ("011 15-2345-6789"), which it reads as a
 * leading "9". They stay in the box without counting against the country's length.
 */
function uncountedLength(country: string, digits: string): number {
  // One digit past the longest national number is enough to show them; more would read as a calling code.
  const head = digits.slice(0, maxNationalDigits(country) + 1);
  const national = nationalSignificant(country, head);
  return national !== undefined && national.length < head.length ? head.length - national.length : 0;
}

function readNational(country: string, text: string): string {
  const digits = digitsOf(text);
  const max = maxNationalDigits(country);
  const uncounted = uncountedLength(country, digits);
  if (uncounted > 0) return trimLead(keepDigits(text, max + uncounted));
  const code = countryByCode(country)?.dial.slice(1);
  if (code && digits.length > max && digits.startsWith(code)) {
    // The country's own calling code typed without "+", then a whole national number ("919876543210"): drop the code.
    if (digits.length === code.length + max) return trimLead(keepDigits(splitAfterDigits(text, code.length)[1], max));
    // Fewer digits: the code is still being typed in front of a number, or a key too many followed a number that starts
    // with it ("9198765432", then "1"). Kept as typed, so the extra digit shows; nationalDigits counts none of them.
    if (digits.length < code.length + max) return trimLead(keepDigits(text, digits.length));
  }
  return trimLead(keepDigits(text, max));
}

/**
 * A calling code typed in front of a number already in the box: "+", then "+9", before "98765 43210". Read whole,
 * "+98765 43210" is Iran's +98, so until the code is whole the box keeps what's typed and holds the number it went in
 * front of. A whole code ("+91") is read with the rest as usual.
 */
function holdNumber(country: string, raw: string, previous: PhoneEntry): PhoneEntry | undefined {
  const before = previous.held ?? (nationalDigits(previous) ? previous.number : "");
  if (!before || raw.length <= before.length || !raw.endsWith(before)) return undefined;
  const head = raw.slice(0, raw.length - before.length);
  const headDigits = digitsOf(head);
  let code = headDigits;
  let held = before;
  if (!startsInternational(head)) {
    const prefix = internationalPrefixLength(country, headDigits + digitsOf(before));
    if (prefix === 0) return undefined;
    code = headDigits.slice(prefix);
    // The prefix's first "0" was already in the box, read as a trunk prefix ("0" before "00"): it isn't the number's.
    if (prefix > headDigits.length) held = trimLead(splitAfterDigits(before, prefix - headDigits.length)[1]);
  }
  if (code.length >= 3 || leadingCallingCode(code)) return undefined;
  return { country, number: (startsInternational(raw) ? "+" : "") + raw.replace(/[^\d -]/g, "").trimStart(), held };
}

/** The selected country if it uses the calling code, else the country the number belongs to, else the code's main one. */
function countryForCallingCode(code: string, selected: string, national: string): string {
  const sharing = COUNTRIES.filter((c) => c.dial === `+${code}`).map((c) => c.code);
  if (sharing.includes(selected)) return selected;
  // libphonenumber names the country of a whole number (+1 416… is Canada), listing the main one first when it can't.
  const fromNumber = parsePhoneNumberFromString(`+${code}${national}`)
    ?.getPossibleCountries()
    .find((c) => sharing.includes(c));
  const main = MAIN_COUNTRY_BY_CALLING_CODE[code];
  return fromNumber ?? (main && sharing.includes(main) ? main : sharing[0]!);
}

/**
 * Reads what a phone field's box holds, with `country` selected, the way the member meant it. "+", or the country's
 * international prefix ("00" from India), starts an international number, even behind the invisible marks a copied
 * number carries: the picker moves to its country and the box keeps the national part, so a pasted or autofilled
 * "+919876543210" is 98765 43210 in India, not 91987 65432. The country's own calling code typed without "+" is dropped
 * once a whole national number follows it ("919876543210"); with fewer digits the box keeps them all and nothing counts,
 * so a stray key after "9198765432" can't turn it into another number. A trunk prefix ("09876543210") stays in the box
 * without counting as a digit. While a calling code is still being typed ("+", "+9") the box keeps what's there, so it
 * doesn't jump. `clampNationalNumber` caps the national digits last.
 * Use it for every change to the box, passing the entry it changes as `previous` (so a "+91" typed in front of a number
 * already there isn't read as "+98…"), and for every change of country, with `held ?? number` as `raw`.
 */
export function readPhoneEntry(country: string, typed: string, previous?: PhoneEntry): PhoneEntry {
  const raw = plainText(typed);
  const held = previous && holdNumber(country, raw, previous);
  if (held) return held;
  const plus = startsInternational(raw);
  const digits = digitsOf(raw);
  const prefix = plus ? 0 : internationalPrefixLength(country, digits);
  if (!plus && prefix === 0) return { country, number: readNational(country, raw) };
  const code = leadingCallingCode(digits.slice(prefix));
  if (!code) return { country, number: (plus ? "+" : "") + raw.replace(/[^\d -]/g, "").trimStart() };
  const national = splitAfterDigits(raw, prefix + code.length)[1].replace(/^\D+/, "");
  const next = countryForCallingCode(code, country, digitsOf(national));
  return { country: next, number: readNational(next, national) };
}

/**
 * The national number a phone field holds, without a trunk prefix. Empty while a calling code is still being typed,
 * and while the box holds more digits than the country's numbers have, so Send code stays off.
 */
export function nationalDigits({ country, number }: PhoneEntry): string {
  const digits = digitsOf(number);
  if (startsInternational(number) || internationalPrefixLength(country, digits) > 0) return "";
  const national = nationalSignificant(country, digits) ?? digits;
  return national.length > maxNationalDigits(country) ? "" : national;
}

/** The number a phone field holds, as the API takes it ("+919876543210"). */
export function phoneEntryToE164(entry: PhoneEntry): string {
  return `${countryByCode(entry.country)?.dial ?? "+91"}${nationalDigits(entry)}`;
}

/**
 * An E.164 number for reading: "+91 98765 43210" for India's ten digits, otherwise the calling code, a space and the
 * national number ("+91 931000006", "+44 7700900123"). Anything it can't split is returned as it is.
 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const digits = digitsOf(e164);
  const code = e164.trimStart().startsWith("+") ? leadingCallingCode(digits) : undefined;
  if (!code) return e164;
  const national = digits.slice(code.length);
  if (code === "91" && national.length === 10) return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
  return national ? `+${code} ${national}` : `+${code}`;
}

/** What a screen reader hears when the number box moves the country picker ("Country code set to United Kingdom +44"). */
export function phoneCountryNote(country: string): string {
  const c = countryByCode(country);
  return c ? `Country code set to ${c.name} ${c.dial}` : "";
}
