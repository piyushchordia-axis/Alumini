import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BACKDROP_SCRIM,
  DIM_PAGE_TEXT,
  GREYS,
  PLAIN_PAGE_COLOR,
  STATUS_TONES,
  brandTones,
  contrastRatio,
  mixHex,
  pageBackdrop,
  parseHex,
  relativeLuminance,
  type Tone,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import { sampledColours } from "../helpers/colours";

const WHITE = "#ffffff";
const PAGE = PLAIN_PAGE_COLOR;
/** slate-50, the lightest surface grey text and tags sit on (a comment, a table header). */
const SLATE_50 = "#f8fafc";
/** The phone's slate-200 trays (colors.border): the Tabs tray, under an unchosen tab's label, and a chat's day chip. */
const TABS_TRAY = "#e2e8f0";
/** The four seeded institutions' colours (seed.ts): Demo University, Demo College, Demo School and the Samaj. */
const SEEDED = ["#1d4ed8", "#047857", "#b45309", "#c2410c"];
const ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");

/** The page a member's Institution colour background gives an institution: 8% of its colour (pageBackdrop). */
const brandPage = (primary: string) => pageBackdrop({ backdrop: "BRAND" }, { primaryColor: primary, coverImageUrl: null }).color;

describe("GREYS", () => {
  it("are the shared hex values, lightest last, and the dim page text is the secondary grey", () => {
    expect(GREYS).toEqual({ text: "#0f172a", body: "#334155", secondary: "#475569", meta: "#5b6b80", faint: "#748297" });
    const order = [GREYS.text, GREYS.body, GREYS.secondary, GREYS.meta, GREYS.faint].map(relativeLuminance);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(DIM_PAGE_TEXT).toBe(GREYS.secondary);
  });

  it("read as text (4.5:1) on white, the plain page and slate-50, down to the meta grey", () => {
    for (const grey of [GREYS.text, GREYS.body, GREYS.secondary, GREYS.meta]) {
      for (const bg of [WHITE, PAGE, SLATE_50]) expect(contrastRatio(grey, bg), `${grey} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(GREYS.meta, WHITE)).toBeCloseTo(5.44, 2);
    expect(contrastRatio(GREYS.meta, PAGE)).toBeCloseTo(4.97, 2);
    expect(contrastRatio(GREYS.meta, SLATE_50)).toBeCloseTo(5.2, 2);
  });

  it("keep the faint grey to icons, borders and tag edges: 3:1 on white, the page and slate-50, but under 4.5 on white", () => {
    for (const bg of [WHITE, PAGE, SLATE_50]) expect(contrastRatio(GREYS.faint, bg), bg).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(GREYS.faint, WHITE)).toBeCloseTo(3.9, 2);
    expect(contrastRatio(GREYS.faint, WHITE)).toBeLessThan(4.5);
  });

  it("give the secondary grey 4.5:1 on every tinted surface: the Tabs tray, any brand's wash or 10% tint, and the veil over a black photo", () => {
    expect(contrastRatio(GREYS.secondary, TABS_TRAY)).toBeCloseTo(6.15, 2);
    // Which is why a label on it isn't the meta grey.
    expect(contrastRatio(GREYS.meta, TABS_TRAY)).toBeLessThan(4.5);
    expect(contrastRatio(GREYS.secondary, mixHex(PAGE, "#000000", BACKDROP_SCRIM))).toBeGreaterThanOrEqual(4.5);
    for (const c of sampledColours()) {
      expect(contrastRatio(GREYS.secondary, brandTones(c).wash), `${c}'s wash`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(GREYS.secondary, mixHex(c, WHITE, 0.1)), `${c} at 10%`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keep grey text and icons readable on any brand's page tint: the secondary grey at 4.5:1, the faint grey at 3:1", () => {
    for (const c of sampledColours()) {
      const tint = brandPage(c);
      expect(contrastRatio(GREYS.secondary, tint), c).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(GREYS.faint, tint), c).toBeGreaterThanOrEqual(3);
    }
    // The web's slate-400 is the meta grey there, which reads on the seeded tints too.
    for (const c of SEEDED) expect(contrastRatio(GREYS.meta, brandPage(c)), c).toBeGreaterThanOrEqual(4.5);
  });
});

describe("STATUS_TONES", () => {
  const tones = Object.entries(STATUS_TONES);

  it("has the five tones", () => {
    expect(Object.keys(STATUS_TONES).sort()).toEqual(["danger", "info", "neutral", "success", "warning"]);
  });

  it.each(tones)("%s: its ink reads (4.5:1) on its fill, white and the page", (_, tone) => {
    for (const bg of [tone.fill, WHITE, PAGE]) expect(contrastRatio(tone.ink, bg), bg).toBeGreaterThanOrEqual(4.5);
  });

  it.each(tones)("%s: its edge shows (3:1) on white, the page and slate-50", (_, tone) => {
    for (const bg of [WHITE, PAGE, SLATE_50]) expect(contrastRatio(tone.edge, bg), bg).toBeGreaterThanOrEqual(3);
  });

  it("keep the edge at 3:1 and the ink at 4.5:1 on any brand's page tint too, where a tag may sit on the page itself", () => {
    for (const c of sampledColours()) {
      const tint = brandPage(c);
      for (const [name, tone] of tones) {
        expect(contrastRatio(tone.edge, tint), `${name}'s edge on ${c}'s tint`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(tone.ink, tint), `${name}'s ink on ${c}'s tint`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(tones)("%s: white reads (4.5:1) on its solid", (_, tone) => {
    expect(contrastRatio(WHITE, tone.solid)).toBeGreaterThanOrEqual(4.5);
  });

  it("draws the neutral tone in the greys", () => {
    expect(STATUS_TONES.neutral).toEqual({ fill: PAGE, edge: GREYS.faint, ink: GREYS.body, solid: GREYS.secondary });
  });
});

describe("the brand's tones on its tints", () => {
  it("keep the ink at 4.5:1 on 10% and 12% of the brand and on the solid tint, and the edge at 3:1 on white and the plain page", () => {
    for (const c of sampledColours()) {
      const { ink, edge, tint } = brandTones(c);
      expect(contrastRatio(ink, mixHex(c, WHITE, 0.1)), c).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink, mixHex(c, WHITE, 0.12)), c).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink, tint), c).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(edge, WHITE), c).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(edge, PAGE), c).toBeGreaterThanOrEqual(3);
    }
  });

  it("promise the edge only on white and the plain page: a member's Institution colour page, darker, can take it under 3:1", () => {
    // As BrandTones.edge says, so a line drawn on the page itself, not in a card, needs its own check against the tint.
    for (const c of SEEDED) {
      const ratio = contrastRatio(brandTones(c).edge, brandPage(c));
      expect(ratio, c).toBeLessThan(3);
      expect(ratio, c).toBeGreaterThan(2.8);
    }
  });
});

describe("form controls' edges", () => {
  /** The edges fields had before: the web's slate-300 and the phone's colors.border. */
  const OLD_EDGES = ["#cbd5e1", "#e2e8f0"];

  it("show a field at rest at 3:1 in the faint grey, on the white field and the page and slate-50 around it, where the old edges didn't", () => {
    for (const bg of [WHITE, PAGE, SLATE_50]) expect(contrastRatio(GREYS.faint, bg), bg).toBeGreaterThanOrEqual(3);
    for (const edge of OLD_EDGES) expect(contrastRatio(edge, WHITE), edge).toBeLessThan(3);
    // On a member's tint or photo the web's slate-400 steps to the meta grey ([data-backdrop]), darker still.
    expect(contrastRatio(GREYS.meta, WHITE)).toBeGreaterThan(contrastRatio(GREYS.faint, WHITE));
  });

  it("show a focused field in the ink and an invalid one in the danger edge, each at 3:1 on white, for any brand", () => {
    expect(contrastRatio(STATUS_TONES.danger.edge, WHITE)).toBeGreaterThanOrEqual(3);
    for (const c of sampledColours()) expect(contrastRatio(brandTones(c).ink, WHITE), c).toBeGreaterThanOrEqual(3);
  });

  it("are what both apps' fields draw: the web's controlClass and the phone's Input", () => {
    const web = readFileSync(resolve(ROOT, "apps/web/src/components/ui/index.tsx"), "utf8");
    const control = /const controlClass =\s*"([^"]+)"/.exec(web)?.[1]?.split(/\s+/) ?? [];
    expect(control).toEqual(expect.arrayContaining(["border", "border-slate-400", "focus:border-primary-ink", "placeholder:text-slate-500"]));
    expect(control.filter((c) => /^border-slate-[23]00$/.test(c) || /^placeholder:text-slate-[34]00$/.test(c))).toEqual([]);
    expect(/const invalidControlClass = "([^"]+)"/.exec(web)?.[1]).toBe("border-tone-danger-edge");
    const mobile = readFileSync(resolve(ROOT, "apps/mobile/src/components/ui.tsx"), "utf8");
    expect(/^\s*input: \{([^}]*)\}/m.exec(mobile)?.[1]).toMatch(/\bborderColor: colors\.faint\b/);
    expect(readFileSync(resolve(ROOT, "apps/mobile/src/theme/index.tsx"), "utf8")).toMatch(/\bfaint: GREYS\.faint\b/);
  });
});

describe("apps/web/src/index.css", () => {
  const css = readFileSync(resolve(ROOT, "apps/web/src/index.css"), "utf8");
  /** The custom properties declared in a block's body, by name. */
  const declarations = (body: string) =>
    Object.fromEntries([...body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim().toLowerCase()]));
  /** The selector or at-rule before a block, without the comments and statements (an @import) that come before it. */
  const preludeOf = (head: string) => head.replace(/\/\*[\s\S]*?\*\//g, "").split(";").pop()!.trim();
  /** The custom properties of the one rule whose prelude matches `prelude`. */
  const block = (prelude: RegExp) => {
    const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter(([, head]) => prelude.test(preludeOf(head!)));
    expect(rules, `index.css has one rule for ${prelude}`).toHaveLength(1);
    return declarations(rules[0]![2]!);
  };
  const triplet = (hex: string) => {
    const { r, g, b } = parseHex(hex)!;
    return `${r} ${g} ${b}`;
  };

  it("redraws Tailwind's slate-500 and slate-400 as the meta and faint greys, and declares every status tone as STATUS_TONES has it", () => {
    const theme = block(/^@theme$/);
    expect(theme["--color-slate-500"]).toBe(GREYS.meta);
    expect(theme["--color-slate-400"]).toBe(GREYS.faint);
    const expected = Object.fromEntries(
      Object.entries(STATUS_TONES).flatMap(([name, tone]) => (Object.keys(tone) as (keyof Tone)[]).map((part) => [`--color-tone-${name}-${part}`, tone[part]])),
    );
    const declared = Object.fromEntries(Object.entries(theme).filter(([name]) => name.startsWith("--color-tone-")));
    expect(declared).toEqual(expected);
  });

  it("steps grey text one shade darker on a tint or a photo, and in a tinted row (.dim-text): the meta grey to the secondary one, the faint grey to the meta one", () => {
    const darker = { "--color-slate-500": GREYS.secondary, "--color-slate-400": GREYS.meta };
    expect(block(/(^|,\s*)\[data-backdrop\](\s*,|$)/)).toEqual(darker);
    expect(block(/(^|,\s*)\.dim-text(\s*,|$)/)).toEqual(darker);
  });

  it("draws every placeholder in the meta grey, even in a box that doesn't say so itself", () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).toMatch(/::placeholder\s*\{\s*color:\s*var\(--color-slate-500\);\s*\}/);
  });

  it("starts with the default institution colour's tones, as applyTenantTheme writes them", () => {
    const root = block(/^:root$/);
    const tones = brandTones("#1d4ed8");
    expect({
      ink: root["--c-primary-ink"],
      wash: root["--c-primary-wash"],
      ring: root["--c-primary-ring"],
      edge: root["--c-primary-edge"],
      tint: root["--c-primary-tint"],
      onPrimary: root["--c-on-primary"],
    }).toEqual({
      ink: triplet(tones.ink),
      wash: triplet(tones.wash),
      ring: triplet(tones.ring),
      edge: triplet(tones.edge),
      tint: triplet(tones.tint),
      onPrimary: triplet(tones.onPrimary),
    });
    expect(root["--surface-page"]).toBe(PAGE);
  });
});
