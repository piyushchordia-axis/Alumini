import { AVATAR_TONES, SERIES, avatarTone, brandAvatarTone, brandTones, contrastRatio, parseHex, toneHash } from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import { sampledColours } from "../helpers/colours";

/** The four seeded institutions' colours (seed.ts): Demo University, Demo College, Demo School and the Samaj. */
const SEEDED = ["#1d4ed8", "#047857", "#b45309", "#c2410c"];
/** The pale yellow both consoles' Branding e2e types, and white itself. */
const NEAR_WHITE = ["#fef9c3", "#ffffff"];

/** UUID-shaped keys that differ only at the end, the hardest case for a hash to spread. */
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

describe("AVATAR_TONES", () => {
  it("draws every tone's initials at 4.5:1 or more on its circle", () => {
    for (const t of AVATAR_TONES) expect(contrastRatio(t.fg, t.bg), t.name).toBeGreaterThanOrEqual(4.5);
  });

  it("has eight tones, each with its own name and colours, the circles told apart from each other", () => {
    expect(AVATAR_TONES).toHaveLength(8);
    for (const key of ["name", "bg", "fg"] as const) expect(new Set(AVATAR_TONES.map((t) => t[key])).size, key).toBe(AVATAR_TONES.length);
    for (const [i, a] of AVATAR_TONES.entries()) {
      for (const b of AVATAR_TONES.slice(i + 1)) {
        const [x, y] = [parseHex(a.bg)!, parseHex(b.bg)!];
        const apart = Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b));
        expect(apart, `${a.name} and ${b.name}`).toBeGreaterThanOrEqual(24);
      }
    }
  });

  it("is neither the charts' series nor a seeded institution's tint or wash, which mean something else", () => {
    const taken = new Set([...SERIES, ...SEEDED.flatMap((c) => [brandAvatarTone(c).bg, brandTones(c).wash, brandTones(c).tint])]);
    for (const t of AVATAR_TONES) {
      expect(taken.has(t.bg), t.name).toBe(false);
      expect(taken.has(t.fg), t.name).toBe(false);
    }
  });
});

describe("avatarTone", () => {
  it("gives a key one of the tones, whatever its case or the spaces around it", () => {
    for (const key of ["00000000-0000-4000-8000-000000000001", "Infosys", "Tata Consultancy Services"]) {
      const tone = avatarTone(key);
      expect(AVATAR_TONES).toContain(tone);
      expect(avatarTone(key.toUpperCase())).toBe(tone);
      expect(avatarTone(`  ${key}\n`)).toBe(tone);
    }
  });

  it("keeps the tones it gives, so a change to the palette or the hash can't quietly recolour every member", () => {
    expect(avatarTone("00000000-0000-4000-8000-000000000001").name).toBe("red");
    expect(avatarTone("00000000-0000-4000-8000-000000000002").name).toBe("green");
    expect(avatarTone("Infosys").name).toBe("fuchsia");
    // The seeded jobs' companies whose tiles the web-member and mobile-web e2e read as two tones apart.
    expect(avatarTone("Zylo Labs").name).toBe("amber");
    expect(avatarTone("Deloitte").name).toBe("red");
  });

  it("spreads membership ids evenly over the tones", () => {
    const counts = new Map<string, number>();
    for (let n = 0; n < 8000; n++) {
      const name = avatarTone(uuid(n)).name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    expect(counts.size).toBe(AVATAR_TONES.length);
    for (const [name, count] of counts) {
      expect(count, name).toBeGreaterThanOrEqual(800);
      expect(count, name).toBeLessThanOrEqual(1200);
    }
  });

  it("gives ids that differ only in their last digit different tones, mostly", () => {
    const tones = new Set(Array.from({ length: 16 }, (_, n) => avatarTone(uuid(n)).name));
    expect(tones.size).toBeGreaterThanOrEqual(6);
  });
});

describe("toneHash", () => {
  it("gives a whole number from 0 to 2^32 - 1 for any text, the same each time", () => {
    for (const key of ["", "a", "00000000-0000-4000-8000-000000000001", "શ્રી ગુજરાતી સમાજ", "😀 Morning runners"]) {
      const h = toneHash(key);
      expect(Number.isInteger(h), key).toBe(true);
      expect(h, key).toBeGreaterThanOrEqual(0);
      expect(h, key).toBeLessThanOrEqual(2 ** 32 - 1);
      expect(toneHash(key), key).toBe(h);
    }
    expect(toneHash("a")).not.toBe(toneHash("b"));
  });
});

describe("brandAvatarTone", () => {
  it("is the brand's ink on its solid tint, as the web app's primary-tint default and the phone's primaryTint draw it", () => {
    expect(brandAvatarTone("#1d4ed8")).toEqual({ name: "brand", bg: "#e4eafa", fg: "#1d4ed8" });
    for (const c of [...SEEDED, ...NEAR_WHITE]) {
      const tones = brandTones(c);
      expect(brandAvatarTone(c), c).toEqual({ name: "brand", bg: tones.tint, fg: tones.ink });
    }
  });

  it("reads at 4.5:1 for any brand, a near-white one included", () => {
    expect(brandAvatarTone("#fef9c3")).toEqual({ name: "brand", bg: "#fffef8", fg: "#676a62" });
    for (const c of [...sampledColours(), ...NEAR_WHITE]) {
      const { fg, bg } = brandAvatarTone(c);
      expect(contrastRatio(fg, bg), c).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives a colour it can't read the default institution colour's tone", () => {
    expect(brandAvatarTone("nope")).toEqual(brandAvatarTone("#1d4ed8"));
  });
});
