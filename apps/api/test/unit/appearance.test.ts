import {
  BACKDROP_LABELS,
  BACKDROP_SCRIM,
  DIM_PAGE_TEXT,
  MEMBER_BACKDROPS,
  PLAIN_PAGE_COLOR,
  backdropChoices,
  chosenBackdrop,
  contrastRatio,
  memberAppearanceUpdateSchema,
  mixHex,
  pageBackdrop,
  pageInk,
  pageTint,
  parseHex,
  photoRemoval,
  resolveAppearance,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const PHOTO = "https://cdn.example.com/backdrops/me.jpg";
const COVER = "https://cdn.example.com/covers/campus.jpg";
const UNIVERSITY = { primaryColor: "#1d4ed8", coverImageUrl: COVER };
const NO_COVER = { primaryColor: "#047857", coverImageUrl: null };
const PLAIN = { color: PLAIN_PAGE_COLOR, imageUrl: null, scrim: BACKDROP_SCRIM, dimText: false };
/** The demo institutions' colours (seed.ts): Demo University, Demo College, Demo School and Shri Gujarati Samaj. */
const SEEDED = ["#1d4ed8", "#047857", "#b45309", "#c2410c"];

/** The largest difference in any one channel, 0 to 255. */
function channelDistance(a: string, b: string): number {
  const x = parseHex(a)!;
  const y = parseHex(b)!;
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b));
}

describe("resolveAppearance", () => {
  it("fills in what isn't stored with the plain page, as a membership saved before backgrounds existed has nothing", () => {
    for (const stored of [{}, null, undefined]) expect(resolveAppearance(stored)).toEqual({ backdrop: "PLAIN", photoUrl: null });
    expect(resolveAppearance({ backdrop: "BRAND" })).toEqual({ backdrop: "BRAND", photoUrl: null });
    expect(resolveAppearance({ photoUrl: PHOTO })).toEqual({ backdrop: "PLAIN", photoUrl: PHOTO });
  });

  it("reads a backdrop this version doesn't know, or a photo that isn't a URL, as nothing chosen", () => {
    expect(resolveAppearance({ backdrop: "DARK", photoUrl: PHOTO })).toEqual({ backdrop: "PLAIN", photoUrl: PHOTO });
    expect(resolveAppearance({ backdrop: "brand" })).toEqual({ backdrop: "PLAIN", photoUrl: null });
    expect(resolveAppearance({ backdrop: 3, photoUrl: 7 } as never)).toEqual({ backdrop: "PLAIN", photoUrl: null });
    expect(resolveAppearance({ backdrop: "COVER", photoUrl: "" })).toEqual({ backdrop: "COVER", photoUrl: null });
  });

  it("keeps the photo while another backdrop is chosen, and reads Your photo without one as plain", () => {
    expect(resolveAppearance({ backdrop: "BRAND", photoUrl: PHOTO })).toEqual({ backdrop: "BRAND", photoUrl: PHOTO });
    expect(resolveAppearance({ backdrop: "PHOTO", photoUrl: PHOTO })).toEqual({ backdrop: "PHOTO", photoUrl: PHOTO });
    expect(resolveAppearance({ backdrop: "PHOTO", photoUrl: null })).toEqual({ backdrop: "PLAIN", photoUrl: null });
    expect(resolveAppearance({ backdrop: "PHOTO" })).toEqual({ backdrop: "PLAIN", photoUrl: null });
  });

  it("labels every backdrop", () => {
    expect(Object.keys(BACKDROP_LABELS).sort()).toEqual([...MEMBER_BACKDROPS].sort());
    expect(BACKDROP_LABELS).toEqual({ PLAIN: "Plain", BRAND: "Institution colour", COVER: "Institution cover", PHOTO: "Your photo" });
  });
});

describe("pageBackdrop", () => {
  it("is the plain page for Plain, for nothing stored, and before the membership or the institution has loaded", () => {
    expect(pageBackdrop({ backdrop: "PLAIN", photoUrl: PHOTO }, UNIVERSITY)).toEqual(PLAIN);
    expect(pageBackdrop(undefined, UNIVERSITY)).toEqual(PLAIN);
    expect(pageBackdrop(null, null)).toEqual(PLAIN);
    expect(pageBackdrop({ backdrop: "BRAND" }, undefined)).toEqual(PLAIN);
    expect(PLAIN_PAGE_COLOR).toBe("#f1f5f9");
  });

  it("tints the page with 8% of the institution colour, with no photo and darker grey text", () => {
    expect(pageBackdrop({ backdrop: "BRAND" }, UNIVERSITY)).toEqual({ ...PLAIN, color: mixHex("#1d4ed8", "#f8fafc", 0.08), dimText: true });
    const green = pageBackdrop({ backdrop: "BRAND" }, NO_COVER);
    expect(green).toEqual({ ...PLAIN, color: pageTint("#047857", "#f8fafc", DIM_PAGE_TEXT), dimText: true });
    // A colour that can't be read tints with the default institution colour rather than failing.
    expect(pageBackdrop({ backdrop: "BRAND" }, { primaryColor: "blue", coverImageUrl: null }).color).toBe(mixHex("#1d4ed8", "#f8fafc", 0.08));
  });

  it("makes Institution colour visibly different from Plain, with grey text reading at least as well as on Plain", () => {
    const plainGrey = contrastRatio("#64748b", PLAIN_PAGE_COLOR);
    for (const primary of [...SEEDED, "#111111", "#000000", "#fde047"]) {
      const { color } = pageBackdrop({ backdrop: "BRAND" }, { primaryColor: primary, coverImageUrl: null });
      // The faint tint this replaced moved one channel by 2 of 255 (#f1f5fb for Demo University), which nobody could see.
      expect(channelDistance(color, PLAIN_PAGE_COLOR), `${primary} gives ${color}`).toBeGreaterThanOrEqual(8);
      expect(contrastRatio(DIM_PAGE_TEXT, color), primary).toBeGreaterThanOrEqual(Math.max(4.5, plainGrey));
    }
  });

  it("lays the cover or the member's photo under the plain page's veil, with darker grey text", () => {
    expect(pageBackdrop({ backdrop: "COVER" }, UNIVERSITY)).toEqual({ color: PLAIN_PAGE_COLOR, imageUrl: COVER, scrim: 0.85, dimText: true });
    expect(pageBackdrop({ backdrop: "PHOTO", photoUrl: PHOTO }, NO_COVER)).toEqual({ color: PLAIN_PAGE_COLOR, imageUrl: PHOTO, scrim: 0.85, dimText: true });
  });

  it("falls back to the plain page while the photo is missing, keeping the choice for when it comes back", () => {
    expect(pageBackdrop({ backdrop: "COVER" }, NO_COVER)).toEqual(PLAIN);
    expect(pageBackdrop({ backdrop: "PHOTO", photoUrl: null }, UNIVERSITY)).toEqual(PLAIN);
    expect(pageBackdrop({ backdrop: "PHOTO" }, UNIVERSITY)).toEqual(PLAIN);
  });

  it("keeps grey text one shade darker readable through the veil over any photo, a black one included", () => {
    expect(DIM_PAGE_TEXT).toBe("#475569");
    for (const photo of ["#000000", "#ffffff", "#1d4ed8", "#7f1d1d", "#808080"]) {
      const seen = mixHex(PLAIN_PAGE_COLOR, photo, BACKDROP_SCRIM);
      expect(contrastRatio(DIM_PAGE_TEXT, seen), photo).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("pageInk", () => {
  it("is the brand as it is on the plain page", () => {
    for (const primary of SEEDED) expect(pageInk(primary, pageBackdrop(undefined, { primaryColor: primary, coverImageUrl: null }))).toBe(primary);
  });

  it("reads at 4.5:1, under a current link's wash, on a tint and over the darkest photo the veil lets through", () => {
    for (const primary of [...SEEDED, "#111111", "#fde047", "#ffffff"]) {
      const institution = { primaryColor: primary, coverImageUrl: COVER };
      for (const [page, darkest] of [
        [pageBackdrop({ backdrop: "BRAND" }, institution), null],
        [pageBackdrop({ backdrop: "COVER" }, institution), mixHex(PLAIN_PAGE_COLOR, "#000000", BACKDROP_SCRIM)],
      ] as const) {
        const ink = pageInk(primary, page);
        // The web sidebar's current link: the brand at 12% (bg-primary/12) on the page.
        const under = mixHex(primary, darkest ?? page.color, 0.12);
        expect(contrastRatio(ink, under), `${primary} on ${page.imageUrl ? "a photo" : "its tint"}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(ink, darkest ?? page.color)).toBeGreaterThanOrEqual(4.5);
      }
    }
    // A brand that already reads keeps its colour on the tint.
    expect(pageInk("#1d4ed8", pageBackdrop({ backdrop: "BRAND" }, UNIVERSITY))).toBe("#1d4ed8");
  });
});

describe("the choices both apps show", () => {
  it("offers the cover only at an institution that has one, in a fixed order", () => {
    expect(backdropChoices(UNIVERSITY)).toEqual(["PLAIN", "BRAND", "COVER", "PHOTO"]);
    expect(backdropChoices(NO_COVER)).toEqual(["PLAIN", "BRAND", "PHOTO"]);
  });

  it("shows Plain as chosen while the chosen cover is gone, since the page is plain then", () => {
    expect(chosenBackdrop({ backdrop: "COVER" }, UNIVERSITY)).toBe("COVER");
    expect(chosenBackdrop({ backdrop: "COVER" }, NO_COVER)).toBe("PLAIN");
    expect(chosenBackdrop({ backdrop: "BRAND", photoUrl: PHOTO }, NO_COVER)).toBe("BRAND");
    expect(chosenBackdrop({ backdrop: "PHOTO" }, UNIVERSITY)).toBe("PLAIN");
    expect(chosenBackdrop(undefined, UNIVERSITY)).toBe("PLAIN");
  });

  it("removes the photo without touching another choice, and falls back to Plain only from Your photo", () => {
    expect(photoRemoval({ backdrop: "PHOTO", photoUrl: PHOTO })).toEqual({ backdrop: "PLAIN", photoUrl: null });
    expect(photoRemoval({ backdrop: "BRAND", photoUrl: PHOTO })).toEqual({ photoUrl: null });
    expect(photoRemoval({ backdrop: "COVER", photoUrl: PHOTO })).toEqual({ photoUrl: null });
    // Each is a change the API takes.
    for (const stored of [{ backdrop: "PHOTO", photoUrl: PHOTO }, { backdrop: "BRAND", photoUrl: PHOTO }]) {
      expect(memberAppearanceUpdateSchema.safeParse(photoRemoval(stored)).success).toBe(true);
    }
  });
});

describe("memberAppearanceUpdateSchema", () => {
  const parse = (input: unknown) => memberAppearanceUpdateSchema.safeParse(input);

  it("leaves out a key that isn't sent, so it stays as stored", () => {
    expect(parse({ backdrop: "BRAND" })).toMatchObject({ success: true, data: { backdrop: "BRAND" } });
    expect(parse({ backdrop: "BRAND" }).data).not.toHaveProperty("photoUrl");
    expect(parse({ photoUrl: PHOTO }).data).not.toHaveProperty("backdrop");
    expect(parse({})).toMatchObject({ success: true, data: {} });
  });

  it("takes a photo as a link, stored as parsed, and null to remove it", () => {
    expect(parse({ backdrop: "PLAIN", photoUrl: null }).data).toEqual({ backdrop: "PLAIN", photoUrl: null });
    expect(parse({ photoUrl: "https://CDN.example.com/a b.jpg" }).data).toEqual({ photoUrl: "https://cdn.example.com/a%20b.jpg" });
  });

  it("refuses an unknown backdrop, a link with a user name, a non-link and any other key", () => {
    for (const bad of [
      { backdrop: "DARK" },
      { backdrop: null },
      { photoUrl: "https://me@cdn.example.com/a.jpg" },
      { photoUrl: "javascript:alert(1)" },
      { photoUrl: "not a link" },
      { backdrop: "PLAIN", theme: "dark" },
      { backdrop: "PLAIN", avatarUrl: PHOTO },
    ]) {
      expect(parse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
