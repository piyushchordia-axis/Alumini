import {
  BRAND_SWATCHES,
  BRANDING_FIELD_LABELS,
  COMMON_TIME_ZONES,
  blankToNull,
  brandContrastWarnings,
  brandPreviewColours,
  brandPreviewText,
  brandingDraft,
  brandingSave,
  contrastRatio,
  contrastText,
  isHexColour,
  isSwatchChosen,
  localTimeZone,
  normalizeHexInput,
  onColor,
  swatchLabel,
  timeZoneLabel,
  timeZoneOptions,
  type BrandingDraft,
  type TenantPublicDto,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const SAMAJ: TenantPublicDto = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "shri-gujarati-samaj",
  name: "Shri Gujarati Samaj",
  shortName: "Samaj",
  type: "OTHER",
  city: "Mumbai",
  country: "IN",
  logoUrl: "https://cdn.example.com/logo.png",
  primaryColor: "#c2410c",
  status: "ACTIVE",
  coverImageUrl: "https://cdn.example.com/cover.jpg",
  secondaryColor: "#7c2d12",
  tagline: "Community, culture and connection.",
  welcomeMessage: "Welcome home.",
  websiteUrl: "https://samaj.example.org",
  timezone: "Asia/Kolkata",
  settings: {} as TenantPublicDto["settings"],
};

const draft = (over: Partial<BrandingDraft> = {}): BrandingDraft => ({ ...brandingDraft(SAMAJ), ...over });
/** The four seeded institutions' colours (seed.ts). */
const SEEDED = ["#1d4ed8", "#047857", "#b45309", "#c2410c"];

describe("brandingDraft", () => {
  it("copies all twelve parts of the look the form edits, and nothing else", () => {
    expect(brandingDraft(SAMAJ)).toEqual({
      name: "Shri Gujarati Samaj",
      shortName: "Samaj",
      tagline: "Community, culture and connection.",
      welcomeMessage: "Welcome home.",
      websiteUrl: "https://samaj.example.org",
      city: "Mumbai",
      country: "IN",
      timezone: "Asia/Kolkata",
      primaryColor: "#c2410c",
      secondaryColor: "#7c2d12",
      logoUrl: "https://cdn.example.com/logo.png",
      coverImageUrl: "https://cdn.example.com/cover.jpg",
    });
    expect(Object.keys(BRANDING_FIELD_LABELS).sort()).toEqual(Object.keys(brandingDraft(SAMAJ)).sort());
  });
});

describe("blankToNull", () => {
  it("makes empty and spaces-only text null, and keeps anything else as typed", () => {
    expect(blankToNull("")).toBeNull();
    expect(blankToNull("   ")).toBeNull();
    expect(blankToNull("Pune ")).toBe("Pune ");
  });
});

describe("isHexColour and normalizeHexInput", () => {
  it("take # and six hex digits in any case, as hexColorSchema does", () => {
    for (const good of ["#1d4ed8", "#1D4ED8", " #0f766e "]) expect(isHexColour(good), good).toBe(true);
    for (const bad of ["1d4ed8", "#fff", "#12", "#1d4ed8f", "#12345g", "teal", ""]) expect(isHexColour(bad), bad).toBe(false);
  });

  it("lower-case the box, take out spaces and put one # in front", () => {
    expect(normalizeHexInput("1D4ED8")).toBe("#1d4ed8");
    expect(normalizeHexInput("##0F766E")).toBe("#0f766e");
    expect(normalizeHexInput(" #0f 766e ")).toBe("#0f766e");
    expect(normalizeHexInput("#12")).toBe("#12");
  });

  it("leave an empty box empty and keep what isn't hex, so the box can say what's wrong", () => {
    expect(normalizeHexInput("")).toBe("");
    expect(normalizeHexInput("#")).toBe("");
    expect(normalizeHexInput("Teal")).toBe("#teal");
  });
});

describe("BRAND_SWATCHES", () => {
  it("are distinct colours, the seeded institutions' among them, with no purple", () => {
    const hexes = BRAND_SWATCHES.map((s) => s.hex);
    expect(new Set(hexes).size).toBe(hexes.length);
    expect(new Set(BRAND_SWATCHES.map((s) => s.name)).size).toBe(hexes.length);
    for (const seeded of SEEDED) expect(hexes).toContain(seeded);
    for (const hex of hexes) {
      expect(isHexColour(hex) && hex === hex.toLowerCase(), hex).toBe(true);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
      // Purple and violet have red and blue both well above green.
      expect(Math.min(r, b) > g + 40, `${hex} reads as purple`).toBe(false);
    }
  });

  it("each take white text at 4.5:1 or better and draw no warning", () => {
    for (const { hex } of BRAND_SWATCHES) {
      expect(contrastRatio("#ffffff", hex), hex).toBeGreaterThanOrEqual(4.5);
      expect(onColor(hex), hex).toBe("#ffffff");
      expect(brandContrastWarnings({ primaryColor: hex, secondaryColor: hex }), hex).toEqual({});
    }
  });

  it("are named with their colour, and chosen however the box writes it", () => {
    const teal = BRAND_SWATCHES.find((s) => s.name === "Teal")!;
    expect(swatchLabel(teal)).toBe("Teal, #0f766e");
    expect(isSwatchChosen(teal, "#0F766E")).toBe(true);
    expect(isSwatchChosen(teal, "0f766e")).toBe(true);
    expect(isSwatchChosen(teal, "#0f766f")).toBe(false);
  });
});

describe("contrastRatio, as the warnings use it", () => {
  it("is 21 for white on black and 1 for a colour on itself", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
  });

  it("is written to one decimal, rounded down", () => {
    expect(contrastText(21)).toBe("21.0:1");
    expect(contrastText(4.49)).toBe("4.4:1");
    expect(contrastText(3.26)).toBe("3.2:1");
  });
});

describe("brandContrastWarnings", () => {
  it("says white text is hard to read on a near-white primary colour, with the ratio, and that buttons use dark text", () => {
    const { primaryColor } = brandContrastWarnings({ primaryColor: "#fef9c3", secondaryColor: "#7c2d12" });
    expect(primaryColor).toBe(`White text is hard to read on this colour (${contrastText(contrastRatio("#ffffff", "#fef9c3"))}), so buttons filled with it use dark text, and links a darker shade of it.`);
    expect(primaryColor).toMatch(/\(1\.\d:1\)/);
    // A mid blue just too light for white text, as typed in capitals.
    expect(brandContrastWarnings({ primaryColor: "#3B82F6", secondaryColor: "#0f172a" }).primaryColor).toMatch(/^White text is hard to read on this colour \(3\.6:1\)/);
  });

  it("says a primary colour nearly as dark as the text looks black", () => {
    for (const hex of ["#0f172a", "#111827", "#000000", "#172554"]) {
      expect(brandContrastWarnings({ primaryColor: hex, secondaryColor: "#0f172a" }).primaryColor, hex).toBe("This colour is so dark that small icons and chosen states in it look black.");
    }
  });

  it("says nothing of the seeded colours, of a colour still being typed, or of the secondary colour", () => {
    for (const hex of SEEDED) expect(brandContrastWarnings({ primaryColor: hex, secondaryColor: "#ffffff" }), hex).toEqual({});
    expect(brandContrastWarnings({ primaryColor: "#fef", secondaryColor: "#0f172a" })).toEqual({});
    expect(brandContrastWarnings({ primaryColor: "#1d4ed8", secondaryColor: "#fef9c3" }).secondaryColor).toBeUndefined();
  });
});

describe("brandPreviewColours", () => {
  const saved = { primaryColor: "#c2410c", secondaryColor: "#7c2d12" };

  it("draws the draft's colours, lower-cased", () => {
    expect(brandPreviewColours({ primaryColor: "#0F766E", secondaryColor: "#064e3b" }, saved)).toEqual({ from: "#0f766e", to: "#064e3b", text: "#ffffff" });
  });

  it("falls back to the saved colour for one still being typed, and to the defaults when neither is a colour", () => {
    expect(brandPreviewColours({ primaryColor: "#12", secondaryColor: "#064e3b" }, saved).from).toBe("#c2410c");
    expect(brandPreviewColours({ primaryColor: "#0f766e", secondaryColor: "" }, saved).to).toBe("#7c2d12");
    expect(brandPreviewColours({ primaryColor: "x", secondaryColor: "y" }, { primaryColor: "z", secondaryColor: "w" })).toMatchObject({ from: "#1d4ed8", to: "#0f172a" });
  });

  it("writes dark text on a light gradient", () => {
    expect(brandPreviewColours({ primaryColor: "#fef9c3", secondaryColor: "#fde68a" }, saved).text).not.toBe("#ffffff");
  });
});

describe("brandingSave", () => {
  it("sends the whole draft, trimmed, with empty texts as null", () => {
    const result = brandingSave(draft({ name: "  Shri Gujarati Samaj ", tagline: "", city: "  ", country: "in" }), SAMAJ);
    expect(result.errors).toBeUndefined();
    expect(result.input).toEqual({ ...brandingDraft(SAMAJ), tagline: null, city: null, country: "IN" });
  });

  it("refuses a colour that isn't #RRGGBB, under that colour, in the schema's words", () => {
    expect(brandingSave(draft({ primaryColor: "#12" }), SAMAJ).errors).toEqual({ primaryColor: "Use a #RRGGBB colour" });
    expect(brandingSave(draft({ secondaryColor: "" }), SAMAJ).errors).toEqual({ secondaryColor: "Use a #RRGGBB colour" });
  });

  it("says in words what's wrong with a short name, a website without its scheme, or an unknown time zone", () => {
    expect(brandingSave(draft({ name: "S" }), SAMAJ).errors).toEqual({ name: "Enter a name of 2 to 120 characters" });
    expect(brandingSave(draft({ websiteUrl: "samaj.example.org" }), SAMAJ).errors).toEqual({ websiteUrl: "Enter the whole address, starting with https://" });
    expect(brandingSave(draft({ timezone: "Mars/Olympus" }), SAMAJ).errors).toEqual({ timezone: "Unknown time zone" });
  });

  it("lists each problem once, by field", () => {
    const { errors } = brandingSave(draft({ name: "", primaryColor: "red", tagline: "x".repeat(161) }), SAMAJ);
    expect(errors).toEqual({ name: "Enter a name of 2 to 120 characters", primaryColor: "Use a #RRGGBB colour", tagline: "Keep the tagline to 160 characters" });
  });

  it("sends a colour that draws a warning: a warning never stops a save", () => {
    for (const hex of ["#fef9c3", "#3b82f6", "#0f172a", "#000000"]) {
      expect(brandContrastWarnings({ primaryColor: hex, secondaryColor: "#7c2d12" }).primaryColor, hex).toBeDefined();
      const result = brandingSave(draft({ primaryColor: hex }), SAMAJ);
      expect(result.errors, hex).toBeUndefined();
      expect(result.input?.primaryColor, hex).toBe(hex);
    }
    expect(brandingSave(draft({ primaryColor: "#fef9c3", secondaryColor: "#ffffff" }), SAMAJ).input?.secondaryColor).toBe("#ffffff");
  });

  it("leaves the time zone the form started with to the server, which took it, but checks one chosen here", () => {
    // A zone the device doesn't know (here, one nobody does), saved before: a tagline edit still goes, zone and all.
    const saved = { ...SAMAJ, timezone: "Mars/Olympus" };
    const result = brandingSave({ ...brandingDraft(saved), tagline: "New tagline" }, saved);
    expect(result.errors).toBeUndefined();
    expect(result.input).toMatchObject({ tagline: "New tagline", timezone: "Mars/Olympus" });
    // Compared trimmed, and still sent trimmed.
    expect(brandingSave({ ...brandingDraft(saved), timezone: " Mars/Olympus " }, saved).input?.timezone).toBe("Mars/Olympus");
    // Emptied, or changed to one the device can't read, it's checked as before.
    expect(brandingSave({ ...brandingDraft(saved), timezone: "" }, saved).errors).toHaveProperty("timezone");
    expect(brandingSave(draft({ timezone: "Mars/Olympus" }), SAMAJ).errors).toEqual({ timezone: "Unknown time zone" });
    expect(brandingSave(draft({ timezone: "Europe/London" }), SAMAJ).input?.timezone).toBe("Europe/London");
  });
});

describe("brandPreviewText", () => {
  it("shows the name, tagline and initials trimmed, the same on both apps", () => {
    expect(brandPreviewText(draft({ name: " Shri Gujarati Samaj ", shortName: "  SGS", tagline: " Community. " }))).toEqual({ title: "Shri Gujarati Samaj", initialsOf: "SGS", tagline: "Community." });
  });

  it("stands in a name while the box is empty, takes the initials from it with no short name, and drops an empty tagline", () => {
    expect(brandPreviewText(draft({ name: "  ", shortName: null, tagline: null }))).toEqual({ title: "Your institution", initialsOf: "Your institution", tagline: null });
    expect(brandPreviewText(draft({ shortName: "   ", tagline: "  " }))).toEqual({ title: "Shri Gujarati Samaj", initialsOf: "Shri Gujarati Samaj", tagline: null });
  });
});

describe("timeZoneOptions and timeZoneLabel", () => {
  it("put the value first, then the extra zones, the device's and the common ones, each once", () => {
    const zones = timeZoneOptions("Europe/London", ["America/Bogota", null, "Europe/London", "", "Asia/Kolkata"]);
    expect(zones.slice(0, 2)).toEqual(["Europe/London", "America/Bogota"]);
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones).toContain(localTimeZone());
    for (const zone of COMMON_TIME_ZONES) expect(zones).toContain(zone);
    expect(zones.indexOf("Asia/Kolkata")).toBe(2);
  });

  it("offer the device's and the common zones with nothing chosen", () => {
    expect(timeZoneOptions(null)).toEqual([...new Set([localTimeZone(), ...COMMON_TIME_ZONES])]);
  });

  it("label a zone with its offset at that moment, and a zone it can't read by name alone", () => {
    expect(timeZoneLabel("Asia/Kolkata")).toBe("Asia/Kolkata (GMT+5:30)");
    expect(timeZoneLabel("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe("America/New York (GMT-5)");
    expect(timeZoneLabel("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe("America/New York (GMT-4)");
    expect(timeZoneLabel("Mars/Olympus")).toBe("Mars/Olympus");
  });
});
