import { GREYS, brandTones, contrastRatio, inkOn, mixHex, onColor, pageTint, parseHex, relativeLuminance, toHex } from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import { sampledColours } from "../helpers/colours";

const WHITE = "#ffffff";
/** The plain page, and the tray a reaction chip sits in on the phone. */
const PAGE = "#f1f5f9";
/** The four seeded institutions' colours (seed.ts): Demo University, Demo College, Demo School and the Samaj. */
const SEEDED = ["#1d4ed8", "#047857", "#b45309", "#c2410c"];
const NEAR_WHITE = "#fde047";
const NEAR_BLACK = "#111827";
/** Brands so pale that their own tints would vanish into the tray: sky-100, cyan-400, and white itself. */
const PALE = ["#e0f2fe", "#22d3ee", WHITE];
const ALL = [...SEEDED, NEAR_WHITE, NEAR_BLACK, ...PALE];

describe("parseHex and toHex", () => {
  it("read #rrggbb in any case, with or without the #, and write it back in lower case", () => {
    expect(parseHex("#1D4ED8")).toEqual({ r: 29, g: 78, b: 216 });
    expect(parseHex(" 1d4ed8 ")).toEqual({ r: 29, g: 78, b: 216 });
    expect(toHex({ r: 29, g: 78, b: 216 })).toBe("#1d4ed8");
  });

  it("refuse anything that isn't six hex digits", () => {
    for (const bad of ["#fff", "blue", "#1d4ed", "#1d4ed8f", "#12345g", ""]) expect(parseHex(bad)).toBeNull();
  });

  it("round and clamp channels", () => {
    expect(toHex({ r: 127.5, g: -4, b: 300 })).toBe("#8000ff");
  });
});

describe("mixHex", () => {
  it("gives b at 0, a at 1, and channels in between", () => {
    expect(mixHex("#000000", WHITE, 0)).toBe(WHITE);
    expect(mixHex("#000000", WHITE, 1)).toBe("#000000");
    expect(mixHex("#000000", WHITE, 0.5)).toBe("#808080");
  });

  it("throws on a colour it can't read, rather than drawing black", () => {
    expect(() => mixHex("navy", WHITE, 0.5)).toThrow(RangeError);
  });
});

describe("relativeLuminance and contrastRatio", () => {
  it("follow WCAG 2", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance(WHITE)).toBe(1);
    expect(contrastRatio(WHITE, "#000000")).toBe(21);
    expect(contrastRatio("#000000", WHITE)).toBe(21);
    expect(contrastRatio("#1d4ed8", WHITE)).toBeCloseTo(6.7, 1);
    // The usual check: #767676 is the lightest grey that passes 4.5:1 on white.
    expect(contrastRatio("#767676", WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", WHITE)).toBeLessThan(4.5);
  });
});

describe("inkOn", () => {
  it("leaves a colour that already reads as it is", () => {
    for (const c of SEEDED) expect(inkOn(c)).toBe(c);
    expect(inkOn(NEAR_BLACK)).toBe(NEAR_BLACK);
  });

  it("darkens a light colour just far enough", () => {
    const ink = inkOn(NEAR_WHITE);
    expect(contrastRatio(ink, WHITE)).toBeGreaterThanOrEqual(4.5);
    // Only as far as needed, so it keeps as much of the yellow as it can rather than turning slate.
    expect(contrastRatio(ink, WHITE)).toBeLessThan(4.8);
    expect(ink).not.toBe("#0f172a");
  });

  it("checks against the background it's given, at the ratio it's given", () => {
    expect(contrastRatio(inkOn("#22d3ee", "#e0f9fd", 3), "#e0f9fd")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(inkOn("#22d3ee", "#e0f9fd", 3), "#e0f9fd")).toBeLessThan(4.5);
  });

  it("gives the most contrast it can find on a background too dark to reach", () => {
    expect(inkOn("#1d4ed8", "#000000", 4.5)).toBe("#1d4ed8");
  });
});

describe("onColor", () => {
  it("puts white on dark and mid brands, and slate-900 on light ones", () => {
    for (const c of [...SEEDED, NEAR_BLACK]) expect(onColor(c)).toBe(WHITE);
    expect(onColor(NEAR_WHITE)).toBe("#0f172a");
    expect(onColor(WHITE)).toBe("#0f172a");
  });

  it("falls back to black on a mid-tone where neither white nor slate-900 reaches 4.5:1", () => {
    // Material red 600: white is about 4.2:1 on it and slate-900 about 4.3:1.
    expect(contrastRatio(WHITE, "#e53935")).toBeLessThan(4.5);
    expect(contrastRatio("#0f172a", "#e53935")).toBeLessThan(4.5);
    expect(onColor("#e53935")).toBe("#000000");
  });

  it("gives text that reads (4.5:1) on any colour", () => {
    for (const c of sampledColours()) expect(contrastRatio(onColor(c), c), c).toBeGreaterThanOrEqual(4.5);
  });
});

describe("brandTones", () => {
  it("pins Demo University's tones, which e2e checks the web and phone apps draw", () => {
    expect(brandTones("#1d4ed8")).toEqual({ ink: "#1d4ed8", wash: "#dfe6fa", ring: "#99afed", edge: "#788bbe", tint: "#e4eafa", onPrimary: WHITE });
  });

  it("keeps the seeded institutions' colour as their ink, or a shade so close it can't be told apart, with white on their buttons", () => {
    for (const c of SEEDED) {
      const tones = brandTones(c);
      expect(contrastRatio(tones.ink, c), c).toBeLessThan(1.1);
      expect(tones.onPrimary).toBe(WHITE);
    }
    expect(brandTones("#1d4ed8").ink).toBe("#1d4ed8");
    expect(brandTones("#047857").ink).toBe("#047857");
  });

  it("has an icon that reads on its wash (3:1) and text that reads (4.5:1) on white, the page and a badge's tint, for every brand", () => {
    for (const c of ALL) {
      const { ink, wash } = brandTones(c);
      expect(contrastRatio(ink, wash), `${c}'s ink on its wash`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(ink, WHITE), `${c}'s ink on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink, PAGE), `${c}'s ink on the page`).toBeGreaterThanOrEqual(4.5);
      // A primary Badge: mobile primarySoft is 12% of the brand, web bg-primary/10.
      expect(contrastRatio(ink, mixHex(c, WHITE, 0.12)), `${c}'s ink on its badge`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink, mixHex(c, WHITE, 0.1)), `${c}'s ink on its web badge`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives a chosen chip a wash darker than the tray it sits in and a ring that shows on it, even for a pale brand", () => {
    for (const c of ALL) {
      const { wash, ring } = brandTones(c);
      expect(relativeLuminance(wash), `${c}'s wash`).toBeLessThan(relativeLuminance(PAGE));
      expect(contrastRatio(wash, PAGE), `${c}'s wash on the tray`).toBeGreaterThanOrEqual(1.05);
      expect(contrastRatio(ring, PAGE), `${c}'s ring on the tray`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("keeps those rules across the colour cube", () => {
    for (const c of sampledColours()) {
      const { ink, wash, ring } = brandTones(c);
      expect(contrastRatio(ink, wash), c).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(ink, PAGE), c).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink, mixHex(c, WHITE, 0.12)), c).toBeGreaterThanOrEqual(4.5);
      expect(relativeLuminance(wash), c).toBeLessThan(relativeLuminance(PAGE));
      expect(contrastRatio(ring, PAGE), c).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("darkens a near-white brand's ink and gives its buttons dark text", () => {
    const tones = brandTones(NEAR_WHITE);
    expect(tones.ink).not.toBe(NEAR_WHITE);
    expect(tones.onPrimary).toBe("#0f172a");
    expect(contrastRatio(tones.onPrimary, NEAR_WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it("gives a near-black brand a wash that is visibly a tint, not white, so a chosen chip isn't a black stamp", () => {
    const { ink, wash, ring } = brandTones(NEAR_BLACK);
    expect(ink).toBe(NEAR_BLACK);
    expect(contrastRatio(wash, WHITE)).toBeGreaterThan(1.2);
    expect(relativeLuminance(ring)).toBeLessThan(relativeLuminance(wash));
  });

  it("mixes the wash and ring from the ink with white, 14% and 45%", () => {
    expect(brandTones("#000000")).toMatchObject({ wash: mixHex("#000000", WHITE, 0.14), ring: mixHex("#000000", WHITE, 0.45) });
    for (const c of [...SEEDED, NEAR_WHITE, ...PALE]) {
      const { ink, wash, ring } = brandTones(c);
      expect({ wash, ring }, c).toEqual({ wash: mixHex(ink, WHITE, 0.14), ring: mixHex(ink, WHITE, 0.45) });
    }
  });

  it("draws the edge from the ring, darkened only as far as it takes to read at 3:1 on the plain page, and so on white", () => {
    // Black's ring (#8c8c8c) already shows at 3.07:1, so it is kept as it is; every other colour here darkens its ring.
    let kept = 0;
    for (const c of [...ALL, "#000000"]) {
      const { ring, edge } = brandTones(c);
      expect(contrastRatio(edge, PAGE), `${c}'s edge on the page`).toBeGreaterThanOrEqual(3);
      if (contrastRatio(ring, PAGE) >= 3) {
        expect(edge, c).toBe(ring);
        kept++;
      } else expect(contrastRatio(edge, PAGE), `${c}'s edge is darker than it needs to be`).toBeLessThan(3.3);
    }
    expect(brandTones("#000000").edge).toBe("#8c8c8c");
    expect(kept, "a colour whose ring already shows keeps it").toBeGreaterThan(0);
    for (const c of sampledColours()) {
      const { edge } = brandTones(c);
      expect(contrastRatio(edge, WHITE), c).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(edge, PAGE), c).toBeGreaterThanOrEqual(3);
    }
  });

  it("draws the tint as 12% of the brand on white, a solid colour the ink reads on at 4.5:1, across the colour cube", () => {
    expect(brandTones("#000000").tint).toBe(mixHex("#000000", WHITE, 0.12));
    for (const c of ALL) expect(brandTones(c).tint, c).toBe(mixHex(c, WHITE, 0.12));
    for (const c of sampledColours()) {
      const { ink, tint } = brandTones(c);
      expect(contrastRatio(ink, tint), c).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("falls back to the default institution colour for one it can't read", () => {
    expect(brandTones("navy")).toEqual(brandTones("#1d4ed8"));
  });

  // Both apps' checkboxes and radios (web ChoiceInput, mobile ChoiceMark): a chosen one is the ink box (or ring) on the
  // wash, holding a white tick, beside a label in the text grey and any line under it (the group visibility cards') in
  // the secondary grey; a clear one has a meta-grey edge on white or the page.
  it("draws a chosen choice that reads in any colour: the ink box on its wash, a white tick on it and its text on the wash", () => {
    for (const c of [...ALL, ...sampledColours()]) {
      const { ink, wash } = brandTones(c);
      expect(contrastRatio(ink, wash), `${c}'s box on its wash`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(WHITE, ink), `the tick on ${c}'s box`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(GREYS.text, wash), `a label on ${c}'s wash`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(GREYS.secondary, wash), `a grey line on ${c}'s wash`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("draws a clear box's edge in the meta grey, which shows (3:1) on white and on the page", () => {
    expect(contrastRatio(GREYS.meta, WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(GREYS.meta, PAGE)).toBeGreaterThanOrEqual(3);
  });
});

describe("pageTint", () => {
  const plain = contrastRatio(GREYS.meta, "#f1f5f9");

  it("never makes the meta grey less readable than on the plain page", () => {
    for (const c of [...SEEDED, NEAR_WHITE, NEAR_BLACK, "#000000", WHITE]) expect(contrastRatio(GREYS.meta, pageTint(c)), c).toBeGreaterThanOrEqual(plain);
  });

  it("mixes in at most 8% of the brand, all of it when that stays readable", () => {
    expect(pageTint(NEAR_WHITE)).toBe(mixHex(NEAR_WHITE, "#f8fafc", 0.08));
    for (const c of [...SEEDED, NEAR_BLACK]) {
      const tint = pageTint(c);
      expect(tint).not.toBe("#f8fafc");
      expect(relativeLuminance(tint)).toBeGreaterThanOrEqual(relativeLuminance(mixHex(c, "#f8fafc", 0.08)));
    }
  });

  it("gives the base back when no amount of the brand keeps the text readable", () => {
    expect(pageTint("#000000", "#f1f5f9")).toBe("#f1f5f9");
  });
});
