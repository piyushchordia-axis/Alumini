import { COUNTRIES, countriesPopularFirst, countryName, flagEmoji, isoCountrySchema, searchCountries } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

describe("country list", () => {
  it("covers every dialable region with unique codes, India first", () => {
    expect(COUNTRIES.length).toBeGreaterThan(230);
    expect(COUNTRIES[0]).toEqual({ code: "IN", name: "India", dial: "+91" });
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) expect(c.dial).toMatch(/^\+\d{1,4}$/);
  });

  it("keeps countries that share a calling code apart", () => {
    const plusOne = COUNTRIES.filter((c) => c.dial === "+1").map((c) => c.code);
    expect(plusOne).toEqual(expect.arrayContaining(["US", "CA", "JM"]));
  });

  it("puts popular destinations first without duplicates", () => {
    const list = countriesPopularFirst();
    expect(list.slice(0, 3).map((c) => c.code)).toEqual(["IN", "US", "GB"]);
    expect(list).toHaveLength(COUNTRIES.length);
  });

  it("searches by name, code and dial code, ignoring accents", () => {
    expect(searchCountries("kingdom").map((c) => c.code)).toContain("GB");
    expect(searchCountries("ae").map((c) => c.code)).toContain("AE");
    expect(searchCountries("+971").map((c) => c.code)).toEqual(["AE"]);
    expect(searchCountries("aland").map((c) => c.code)).toContain("AX");
    expect(searchCountries("")).toHaveLength(COUNTRIES.length);
  });

  it("names, flags and validation", () => {
    expect(countryName("np")).toBe("Nepal");
    expect(countryName("ZZ")).toBe("ZZ");
    expect(flagEmoji("IN")).toBe("🇮🇳");
    expect(isoCountrySchema.safeParse("KE").success).toBe(true);
    expect(isoCountrySchema.safeParse("ZZ").success).toBe(false);
  });
});
