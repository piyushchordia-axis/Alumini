import { COUNTRIES, POPULAR_COUNTRY_CODES, formatPhone, nationalDigits, phoneCountryNote, phoneEntryToE164, readPhoneEntry, type PhoneEntry } from "@illuminize/shared";
import { getExampleNumber, type CountryCode } from "libphonenumber-js/min";
import metadata from "libphonenumber-js/min/metadata";
import examples from "libphonenumber-js/mobile/examples";
import { describe, expect, it } from "vitest";
import { normalizePhone } from "../../src/lib/phone";

const sent = (country: string, raw: string) => phoneEntryToE164(readPhoneEntry(country, raw));

/** Types `text` one character at a time at the end of the box, as the apps read a keystroke. */
function typeInto(start: PhoneEntry, text: string): PhoneEntry {
  let entry = start;
  for (const ch of text) entry = readPhoneEntry(entry.country, entry.number + ch, entry);
  return entry;
}

/** Types `text` one character at a time at the start of the box, in front of the number already there. */
function typeInFront(start: PhoneEntry, text: string): PhoneEntry {
  let entry = start;
  [...text].forEach((ch, at) => {
    entry = readPhoneEntry(entry.country, entry.number.slice(0, at) + ch + entry.number.slice(at), entry);
  });
  return entry;
}

describe("readPhoneEntry", () => {
  it("reads a pasted or autofilled Indian number once, never as +91 91…", () => {
    expect(readPhoneEntry("IN", "+919876543210")).toEqual({ country: "IN", number: "9876543210" });
    expect(readPhoneEntry("IN", "+91 98765 43210")).toEqual({ country: "IN", number: "98765 43210" });
    expect(readPhoneEntry("IN", "+91-98765-43210")).toEqual({ country: "IN", number: "98765-43210" });
    expect(readPhoneEntry("IN", "919876543210")).toEqual({ country: "IN", number: "9876543210" });
    expect(readPhoneEntry("IN", "0091 98765 43210")).toEqual({ country: "IN", number: "98765 43210" });
    for (const raw of ["+919876543210", "+91 98765 43210", "919876543210", "0091 98765 43210", "09876543210", "098765 43210", "98765 43210"]) {
      expect(sent("IN", raw), raw).toBe("+919876543210");
    }
  });

  it("keeps a trunk 0 in the box without counting it as a digit", () => {
    expect(readPhoneEntry("IN", "09876543210")).toEqual({ country: "IN", number: "09876543210" });
    expect(readPhoneEntry("IN", "098765 43210")).toEqual({ country: "IN", number: "098765 43210" });
    expect(nationalDigits({ country: "IN", number: "09876543210" })).toBe("9876543210");
    // A digit past the end is dropped, not the trunk's last one.
    expect(readPhoneEntry("IN", "098765432101")).toEqual({ country: "IN", number: "09876543210" });
    expect(sent("GB", "07700 900123")).toBe("+447700900123");
    expect(sent("RU", "8 916 123 45 67")).toBe("+79161234567");
    // Italy's leading 0 is part of the number.
    expect(sent("IT", "06 1234 5678")).toBe("+390612345678");
    // An Argentine mobile is dialled with "0" and "15" around the area code, which libphonenumber reads as a leading 9.
    expect(readPhoneEntry("AR", "011 15-2345-6789")).toEqual({ country: "AR", number: "011 15-2345-6789" });
    expect(sent("AR", "011 15-2345-6789")).toBe("+5491123456789");
    expect(sent("AR", "0351 15 123-4567")).toBe("+5493511234567");
    expect(readPhoneEntry("AR", "011 15-2345-67891")).toEqual({ country: "AR", number: "011 15-2345-6789" });
  });

  it("leaves a national number that merely starts with 91, and caps one that is too long", () => {
    expect(readPhoneEntry("IN", "9198765432")).toEqual({ country: "IN", number: "9198765432" });
    expect(sent("IN", "9198765432")).toBe("+919198765432");
    expect(readPhoneEntry("IN", "98765432101")).toEqual({ country: "IN", number: "9876543210" });
  });

  it("never turns a stray key after a number starting with 91 into another number", () => {
    // Eleven digits starting with 91 are neither a national number nor 91 and one: kept, so the extra key shows, and
    // nothing counts, so Send code stays off until it's deleted.
    for (const raw of ["91987654321", "9198765432 1", "91000000123"]) {
      const entry = readPhoneEntry("IN", raw);
      expect(entry, raw).toEqual({ country: "IN", number: raw });
      expect(nationalDigits(entry), raw).toBe("");
    }
    const india = { country: "IN", number: "" };
    expect(typeInto(india, "91234567890")).toEqual({ country: "IN", number: "91234567890" });
    const demo = typeInto(india, "91000000123");
    expect(demo).toEqual({ country: "IN", number: "91000000123" });
    expect(readPhoneEntry("IN", "9100000012", demo)).toEqual({ country: "IN", number: "9100000012" });
    // A number pasted with "+91" that is a digit too long shows the digit too, rather than losing its first two.
    expect(readPhoneEntry("IN", "+91 91987654321")).toEqual({ country: "IN", number: "91987654321" });
    expect(nationalDigits(readPhoneEntry("IN", "+91 91987654321"))).toBe("");
    // The same in the United Kingdom: "44" goes only once a whole number follows it.
    expect(readPhoneEntry("GB", "44770090012")).toEqual({ country: "GB", number: "44770090012" });
    expect(readPhoneEntry("GB", "447700900123")).toEqual({ country: "GB", number: "7700900123" });
  });

  it("reads a copied number through the invisible marks and other characters it carries", () => {
    // WhatsApp wraps a copied number in U+202A…U+202C, the iPhone's Contacts in U+202D…U+202C.
    expect(readPhoneEntry("IN", "\u202A+44 7700 900123\u202C")).toEqual({ country: "GB", number: "7700 900123" });
    expect(readPhoneEntry("IN", "\u202D+1 (415) 555\u20112671\u202C")).toEqual({ country: "US", number: "415 555-2671" });
    expect(readPhoneEntry("GB", "\u202A+91 98765 43210\u202C")).toEqual({ country: "IN", number: "98765 43210" });
    expect(readPhoneEntry("IN", "\u200E+971 50 123 4567")).toEqual({ country: "AE", number: "50 123 4567" });
    expect(readPhoneEntry("IN", "\u2066+44 7700\u00A0900123\u2069")).toEqual({ country: "GB", number: "7700 900123" });
    expect(readPhoneEntry("IN", "(+44) 7700 900123")).toEqual({ country: "GB", number: "7700 900123" });
    expect(readPhoneEntry("IN", "tel:+447700900123")).toEqual({ country: "GB", number: "7700900123" });
    expect(readPhoneEntry("IN", "\uFF0B44 7700 900123")).toEqual({ country: "GB", number: "7700 900123" });
    expect(readPhoneEntry("IN", "\u202A+9")).toEqual({ country: "IN", number: "+9" });
  });

  it("holds the number already in the box while a calling code is typed in front of it", () => {
    const typed = { country: "IN", number: "98765 43210" };
    // Read whole, "+98765 43210" is Iran's: in front of a number, "+" and "+9" wait for the code to be whole.
    const plus = typeInFront(typed, "+");
    expect(plus).toEqual({ country: "IN", number: "+98765 43210", held: "98765 43210" });
    expect(nationalDigits(plus)).toBe("");
    expect(typeInFront(typed, "+9")).toEqual({ country: "IN", number: "+998765 43210", held: "98765 43210" });
    expect(typeInFront(typed, "+91")).toEqual({ country: "IN", number: "98765 43210" });
    expect(typeInFront(typed, "+44")).toEqual({ country: "GB", number: "98765 43210" });
    // India's "00": the first "0" reads as a trunk prefix, the second makes it the international prefix.
    expect(typeInFront(typed, "0")).toEqual({ country: "IN", number: "098765 43210" });
    expect(typeInFront(typed, "00")).toEqual({ country: "IN", number: "0098765 43210", held: "98765 43210" });
    expect(typeInFront(typed, "0091")).toEqual({ country: "IN", number: "98765 43210" });
    expect(typeInFront({ country: "IN", number: "09876543210" }, "+91")).toEqual({ country: "IN", number: "09876543210" });
    // Taking the "+" out again, or picking a country meanwhile, goes back to the number held.
    expect(readPhoneEntry("IN", "98765 43210", plus)).toEqual(typed);
    expect(readPhoneEntry("GB", plus.held ?? plus.number)).toEqual({ country: "GB", number: "98765 43210" });
    // A paste over the box is read whole, as before.
    expect(readPhoneEntry("IN", "+44 7700 900123", typed)).toEqual({ country: "GB", number: "7700 900123" });
    expect(readPhoneEntry("IN", "+9876543210")).toEqual({ country: "IR", number: "76543210" });
  });

  it("moves the picker to the country of a pasted international number", () => {
    expect(readPhoneEntry("IN", "+44 20 7946 0958")).toEqual({ country: "GB", number: "20 7946 0958" });
    expect(sent("IN", "+44 20 7946 0958")).toBe("+442079460958");
    expect(readPhoneEntry("IN", "+44 (0)7700 900123")).toEqual({ country: "GB", number: "07700 900123" });
    expect(sent("IN", "+44 (0)7700 900123")).toBe("+447700900123");
    expect(readPhoneEntry("IN", "+971 50 123 4567")).toEqual({ country: "AE", number: "50 123 4567" });
    expect(readPhoneEntry("US", "011 44 7700 900123")).toEqual({ country: "GB", number: "7700 900123" });
  });

  it("takes a US number pasted while India is selected", () => {
    expect(readPhoneEntry("IN", "+1 415 555 0100")).toEqual({ country: "US", number: "415 555 0100" });
    expect(sent("IN", "+1 415 555 0100")).toBe("+14155550100");
    expect(readPhoneEntry("IN", "+1 (415) 555-2671")).toEqual({ country: "US", number: "415 555-2671" });
  });

  it("keeps the selected country when it shares the calling code, else picks the number's or the main one", () => {
    expect(readPhoneEntry("US", "+1 415 555 2671").country).toBe("US");
    expect(readPhoneEntry("CA", "+1 415 555 2671").country).toBe("CA");
    expect(readPhoneEntry("IN", "+1 416 555 0123").country).toBe("CA");
    expect(readPhoneEntry("IN", "+7 916 123 4567").country).toBe("RU");
    expect(readPhoneEntry("KZ", "+7 916 123 4567").country).toBe("KZ");
    expect(readPhoneEntry("IN", "+358 40 123 4567").country).toBe("FI");
    expect(readPhoneEntry("IN", "+1")).toEqual({ country: "US", number: "" });
    expect(readPhoneEntry("IN", "+7")).toEqual({ country: "RU", number: "" });
    expect(readPhoneEntry("IN", "+44")).toEqual({ country: "GB", number: "" });
  });

  it("gives every calling code several countries share the main country libphonenumber lists", () => {
    const shared = [...new Set(COUNTRIES.map((c) => c.dial.slice(1)))].filter((code) => COUNTRIES.filter((c) => c.dial === `+${code}`).length > 1);
    expect(shared.length).toBeGreaterThan(5);
    for (const code of shared) {
      const main = metadata.country_calling_codes[code]?.[0];
      expect(readPhoneEntry("IN", `+${code}`).country, `+${code}`).toBe(main);
    }
  });

  it("keeps what's typed while a calling code is incomplete, and nothing counts until it is", () => {
    for (const raw of ["+", "+9", "00", "009"]) {
      const entry = readPhoneEntry("IN", raw);
      expect(entry, raw).toEqual({ country: "IN", number: raw });
      expect(nationalDigits(entry), raw).toBe("");
    }
    expect(readPhoneEntry("IN", "+91")).toEqual({ country: "IN", number: "" });
    expect(readPhoneEntry("IN", "0091")).toEqual({ country: "IN", number: "" });
    expect(readPhoneEntry("GB", "+9")).toEqual({ country: "GB", number: "+9" });
  });

  it("reads the same number typed a key at a time", () => {
    const india = { country: "IN", number: "" };
    expect(typeInto(india, "+919876543210")).toEqual({ country: "IN", number: "9876543210" });
    expect(typeInto(india, "919876543210")).toEqual({ country: "IN", number: "9876543210" });
    expect(typeInto(india, "09876543210")).toEqual({ country: "IN", number: "09876543210" });
    expect(typeInto(india, "98765 43210")).toEqual({ country: "IN", number: "98765 43210" });
    expect(typeInto(india, "+44 7700 900123")).toEqual({ country: "GB", number: "7700 900123" });
    expect(typeInto({ country: "US", number: "" }, "1 415 555 2671")).toEqual({ country: "US", number: "1 415 555 2671" });
    expect(sent("US", "1 415 555 2671")).toBe("+14155552671");
  });

  it("changes nothing when it reads its own answer again, as each keystroke and country change does", () => {
    for (const [country, raw] of [["IN", "+91 98765 43210"], ["IN", "09876543210"], ["IN", "931000006"], ["IN", "91987654321"], ["US", "14155552671"], ["GB", "+44 (0)7700 900123"], ["AR", "011 15-2345-6789"], ["IN", "+9"]] as const) {
      const once = readPhoneEntry(country, raw);
      expect(readPhoneEntry(once.country, once.number), raw).toEqual(once);
    }
    const held = readPhoneEntry("IN", "+98765 43210", { country: "IN", number: "98765 43210" });
    expect(readPhoneEntry(held.country, held.number, held)).toEqual(held);
  });

  it("caps the national digits when the country changes", () => {
    expect(readPhoneEntry("SG", "98765 43210")).toEqual({ country: "SG", number: "98765 43210" });
    expect(readPhoneEntry("AF", "98765 43210")).toEqual({ country: "AF", number: "98765 4321" });
  });

  it("round-trips every country's example mobile number in every format a phone offers, pasted or typed", () => {
    const popular = new Set<string>(POPULAR_COUNTRY_CODES);
    expect(POPULAR_COUNTRY_CODES.every((c) => getExampleNumber(c, examples))).toBe(true);
    let checked = 0;
    for (const { code: country } of COUNTRIES) {
      const example = getExampleNumber(country as CountryCode, examples);
      if (!example) continue;
      checked += 1;
      const forms = [["IN", example.number], ["IN", example.formatInternational()], [country, example.formatNational()]] as const;
      for (const [selected, raw] of forms) {
        expect(sent(selected, raw), `${raw} with ${selected} selected`).toBe(example.number);
        expect(phoneEntryToE164(typeInto({ country: selected, number: "" }, raw)), `${raw} typed with ${selected} selected`).toBe(example.number);
      }
      if (popular.has(country)) expect(normalizePhone(example.number).e164).toBe(example.number);
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe("the seeded nine-digit Indian numbers", () => {
  it("send, read and format without being garbled", () => {
    const entry = readPhoneEntry("IN", "931000006");
    expect(entry).toEqual({ country: "IN", number: "931000006" });
    expect(nationalDigits(entry)).toBe("931000006");
    expect(phoneEntryToE164(entry)).toBe("+91931000006");
    expect(readPhoneEntry("IN", "+91931000006")).toEqual({ country: "IN", number: "931000006" });
    expect(formatPhone("+91931000006")).toBe("+91 931000006");
  });
});

describe("formatPhone", () => {
  it("groups India's ten digits in fives and shows other countries after their calling code", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
    expect(formatPhone("+447700900123")).toBe("+44 7700900123");
    expect(formatPhone("+14155552671")).toBe("+1 4155552671");
    expect(formatPhone("+971501234567")).toBe("+971 501234567");
  });

  it("returns what it can't split as it is", () => {
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("")).toBe("");
    expect(formatPhone("9876543210")).toBe("9876543210");
    expect(formatPhone("+80012345678")).toBe("+80012345678");
  });
});

describe("phoneCountryNote", () => {
  it("names the country and its calling code", () => {
    expect(phoneCountryNote("GB")).toBe("Country code set to United Kingdom +44");
    expect(phoneCountryNote("ZZ")).toBe("");
  });
});
