import { formatSalary, SALARY_CURRENCIES, SALARY_CURRENCY_LABELS, SALARY_CURRENCY_SYMBOLS, toMajor, toMinor, type SalaryPeriod } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

/** Pay given in major units (rupees, dollars), as people think of it. */
const pay = (min: number | null, max: number | null, currency: string, period: SalaryPeriod) =>
  formatSalary({ minMinor: min == null ? null : toMinor(min, currency), maxMinor: max == null ? null : toMinor(max, currency), currency, period });

describe("formatSalary", () => {
  it("is null when neither end is given", () => {
    expect(formatSalary({ minMinor: null, maxMinor: null, currency: "INR", period: "YEAR" })).toBeNull();
    expect(formatSalary({ currency: "USD", period: "HOUR" })).toBeNull();
  });

  it("writes rupees a year in lakhs", () => {
    expect(pay(2_500_000, 4_000_000, "INR", "YEAR")).toBe("₹25–40 LPA");
    expect(pay(850_000, 850_000, "INR", "YEAR")).toBe("₹8.5 LPA");
    expect(pay(325_000, 412_500, "INR", "YEAR")).toBe("₹3.25–4.13 LPA");
    expect(pay(50_000, null, "INR", "YEAR")).toBe("From ₹0.5 LPA");
  });

  it("switches to crores from 100 lakh, with both ends in the larger end's unit", () => {
    expect(pay(12_000_000, null, "INR", "YEAR")).toBe("From ₹1.2 Cr");
    expect(pay(10_000_000, 10_000_000, "INR", "YEAR")).toBe("₹1 Cr");
    expect(pay(8_000_000, 12_000_000, "INR", "YEAR")).toBe("₹0.8–1.2 Cr");
    expect(pay(9_000_000, 9_900_000, "INR", "YEAR")).toBe("₹90–99 LPA");
    // 99.996 lakh rounds to 100 lakh, which reads as a crore rather than "100 LPA".
    expect(pay(9_999_600, null, "INR", "YEAR")).toBe("From ₹1 Cr");
  });

  it("writes rupees a month or an hour in full, grouped the Indian way", () => {
    expect(pay(40_000, 60_000, "INR", "MONTH")).toBe("₹40,000–60,000/mo");
    expect(pay(120_000, null, "INR", "MONTH")).toBe("From ₹1,20,000/mo");
    expect(pay(null, 12_345_678, "INR", "MONTH")).toBe("Up to ₹1,23,45,678/mo");
    expect(pay(500, 750.5, "INR", "HOUR")).toBe("₹500–750.50/hr");
  });

  it("writes other currencies a year or a month with k and M", () => {
    expect(pay(120_000, 150_000, "USD", "YEAR")).toBe("$120k–150k/yr");
    expect(pay(45_000, 45_000, "GBP", "YEAR")).toBe("£45k/yr");
    expect(pay(3_500_000, 3_500_000, "EUR", "YEAR")).toBe("€3.5M/yr");
    expect(pay(1_250_000, null, "SGD", "YEAR")).toBe("From S$1.25M/yr");
    expect(pay(62_500, null, "CAD", "YEAR")).toBe("From C$62.5k/yr");
    expect(pay(15_000, 20_000, "AED", "MONTH")).toBe("AED 15k–20k/mo");
    expect(pay(800, 1_200, "AUD", "MONTH")).toBe("A$800–1.2k/mo");
    expect(pay(999.5, null, "USD", "MONTH")).toBe("From $999.50/mo");
    // Chosen after rounding: 999,960 is a million, not "1000k".
    expect(pay(999_960, null, "USD", "YEAR")).toBe("From $1M/yr");
  });

  it("writes an hourly rate with up to two decimals, and none when it's whole", () => {
    expect(pay(40, 62.5, "USD", "HOUR")).toBe("$40–62.50/hr");
    expect(pay(40, 40, "USD", "HOUR")).toBe("$40/hr");
    expect(pay(1_200, null, "USD", "HOUR")).toBe("From $1,200/hr");
  });

  it("says From or Up to when only one end is given", () => {
    expect(pay(2_500_000, null, "INR", "YEAR")).toBe("From ₹25 LPA");
    expect(pay(null, 4_000_000, "INR", "YEAR")).toBe("Up to ₹40 LPA");
    expect(pay(null, 150_000, "USD", "YEAR")).toBe("Up to $150k/yr");
  });

  it("shows one amount when both ends read the same", () => {
    expect(pay(4_000_001, 4_000_002, "INR", "YEAR")).toBe("₹40 LPA");
  });

  it("rounds halves away from zero when shortening", () => {
    // 4.125 lakh is exactly halfway between 4.12 and 4.13.
    expect(pay(412_500, null, "INR", "YEAR")).toBe("From ₹4.13 LPA");
    // 62.45k is exactly halfway between 62.4k and 62.5k.
    expect(pay(62_450, null, "USD", "YEAR")).toBe("From $62.5k/yr");
  });

  it("falls back to the code for a currency it doesn't know", () => {
    expect(pay(5_000, null, "CHF", "MONTH")).toBe("From CHF 5k/mo");
  });
});

describe("toMinor and toMajor", () => {
  it("converts with two minor digits for every salary currency", () => {
    for (const currency of SALARY_CURRENCIES) {
      expect(toMinor(62.5, currency)).toBe(6250);
      expect(toMajor(6250, currency)).toBe(62.5);
    }
  });

  it("rounds half away from zero, without binary floating-point drift", () => {
    expect(toMinor(1.005, "INR")).toBe(101);
    expect(toMinor(2.675, "USD")).toBe(268);
    expect(toMinor(-1.005, "INR")).toBe(-101);
    expect(toMinor(-0.025, "USD")).toBe(-3);
    expect(toMinor(0.004, "USD")).toBe(0);
    expect(toMinor(1e21, "USD")).toBe(1e23);
  });

  it("refuses what isn't a number", () => {
    expect(toMinor(Number.NaN, "INR")).toBeNaN();
    expect(toMinor(Number.POSITIVE_INFINITY, "INR")).toBeNaN();
  });

  it("round-trips", () => {
    for (const minor of [0, 1, 99, 6250, 4_000_000_00, 123_456_789_012]) expect(toMinor(toMajor(minor, "INR"), "INR")).toBe(minor);
    for (const major of [0.01, 0.1, 0.29, 62.5, 1234.56, 25_00_000]) expect(toMajor(toMinor(major, "USD"), "USD")).toBe(major);
  });
});

describe("salary currencies", () => {
  it("has a label and a symbol for each", () => {
    for (const currency of SALARY_CURRENCIES) {
      expect(SALARY_CURRENCY_LABELS[currency]).toBeTruthy();
      expect(SALARY_CURRENCY_SYMBOLS[currency]).toBeTruthy();
    }
  });
});
