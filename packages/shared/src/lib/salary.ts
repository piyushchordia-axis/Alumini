import { SALARY_CURRENCIES, SALARY_CURRENCY_SYMBOLS, type SalaryCurrency, type SalaryPeriod } from "../constants";

const MINOR_DIGITS: Record<SalaryCurrency, number> = { INR: 2, USD: 2, EUR: 2, GBP: 2, AED: 2, SGD: 2, CAD: 2, AUD: 2 };

const isSalaryCurrency = (currency: string): currency is SalaryCurrency => (SALARY_CURRENCIES as readonly string[]).includes(currency);
const minorDigits = (currency: string) => (isSalaryCurrency(currency) ? MINOR_DIGITS[currency] : 2);

/**
 * An amount typed in major units (rupees, dollars) as whole minor units (paise, cents), rounded half away from zero. The
 * decimal point moves in the text, not by multiplying, so 1.005 becomes 101 rather than 100.49999… rounded to 100.
 * Everything here rounds the size of an amount and puts the sign back, because Math.round takes -2.5 to -2.
 */
export function toMinor(major: number, currency: string): number {
  if (!Number.isFinite(major)) return Number.NaN;
  const digits = minorDigits(currency);
  const text = String(Math.abs(major));
  const shifted = text.includes("e") ? Math.abs(major) * 10 ** digits : Number(`${text}e${digits}`);
  return major < 0 ? -Math.round(shifted) : Math.round(shifted);
}

/** Minor units back to major units, as a form shows them for editing. */
export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** minorDigits(currency);
}

/** Digits in groups of three, or as India groups them past the thousands: 1,20,000. Written by hand, as Hermes may lack Intl. */
function groupDigits(digits: string, indian: boolean): string {
  if (digits.length <= 3) return digits;
  const size = indian ? 2 : 3;
  const groups = [digits.slice(-3)];
  let rest = digits.slice(0, -3);
  while (rest.length > size) {
    groups.push(rest.slice(-size));
    rest = rest.slice(0, -size);
  }
  groups.push(rest);
  return groups.reverse().join(",");
}

/**
 * `minor` counted in units of `unitMinor` minor units, shown with up to `decimals` decimals. "trim" drops trailing zeros
 * (8.5 LPA); "money" shows a fraction with all its digits or none (62.50, 40).
 */
function amount(minor: number, unitMinor: number, decimals: number, style: "trim" | "money", indian: boolean): string {
  const scale = 10 ** decimals;
  const units = Math.round(Math.abs(minor) / (unitMinor / scale));
  const whole = Math.floor(units / scale);
  let fraction = String(units - whole * scale).padStart(decimals, "0");
  if (style === "trim") fraction = fraction.replace(/0+$/, "");
  else if (/^0*$/.test(fraction)) fraction = "";
  return `${minor < 0 ? "-" : ""}${groupDigits(String(whole), indian)}${fraction ? `.${fraction}` : ""}`;
}

/** Thousands as k and millions as M, with plain amounts under a thousand: $800, $62.5k, $3.5M. */
function compact(minor: number, perMajor: number): string {
  if (Math.abs(minor) < 1000 * perMajor) return amount(minor, perMajor, 2, "money", false);
  // Chosen after rounding to tenths of a thousand, so 999,960 is $1M rather than $1000k.
  if (Math.round(Math.abs(minor) / (100 * perMajor)) < 10_000) return `${amount(minor, 1000 * perMajor, 1, "trim", false)}k`;
  return `${amount(minor, 1_000_000 * perMajor, 2, "trim", false)}M`;
}

const PERIOD_SUFFIX: Record<SalaryPeriod, string> = { YEAR: "/yr", MONTH: "/mo", HOUR: "/hr" };

/**
 * A job's pay as people write it: "₹25–40 LPA" (crores from 100 lakh: "₹1.2 Cr"), "₹40,000–60,000/mo", "$120k–150k/yr",
 * "$40–62.50/hr", or "From …" and "Up to …" when only one end is given. Null when neither is. Needs no Intl number
 * formatting, which Hermes may not have.
 */
export function formatSalary(salary: { minMinor?: number | null; maxMinor?: number | null; currency: string; period: SalaryPeriod }): string | null {
  const min = salary.minMinor != null && Number.isFinite(salary.minMinor) ? salary.minMinor : null;
  const max = salary.maxMinor != null && Number.isFinite(salary.maxMinor) ? salary.maxMinor : null;
  if (min == null && max == null) return null;
  const { currency, period } = salary;
  const perMajor = 10 ** minorDigits(currency);
  const symbol = isSalaryCurrency(currency) ? SALARY_CURRENCY_SYMBOLS[currency] : `${currency} `;

  let format: (minor: number) => string;
  let suffix = PERIOD_SUFFIX[period];
  if (currency === "INR" && period === "YEAR") {
    const lakh = 100_000 * perMajor;
    // Both ends in the unit of the larger one, so a range reads "₹0.8–1.2 Cr" with one unit after it.
    const larger = Math.max(Math.abs(min ?? 0), Math.abs(max ?? 0));
    const inCrores = Math.round(larger / (lakh / 100)) >= 100 * 100;
    const unit = inCrores ? 100 * lakh : lakh;
    format = (minor) => amount(minor, unit, 2, "trim", true);
    suffix = inCrores ? " Cr" : " LPA";
  } else if (period === "HOUR" || currency === "INR") {
    format = (minor) => amount(minor, perMajor, 2, "money", currency === "INR");
  } else {
    format = (minor) => compact(minor, perMajor);
  }

  const low = min == null ? null : format(min);
  const high = max == null ? null : format(max);
  if (low != null && high != null) return low === high ? `${symbol}${low}${suffix}` : `${symbol}${low}–${high}${suffix}`;
  if (low != null) return `From ${symbol}${low}${suffix}`;
  return `Up to ${symbol}${high}${suffix}`;
}
