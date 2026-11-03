import { describe, expect, it } from "vitest";
import { initials as mobileInitials } from "../../../mobile/src/lib/format";
import { initials as webInitials } from "../../../web/src/lib/format";

/** A group's avatar shows its initials on both apps, which must agree, and never draw half an emoji. */
describe.each([
  ["web", webInitials],
  ["mobile", mobileInitials],
])("initials on %s", (_app, initials) => {
  it("takes the first two words, skipping symbols", () => {
    expect(initials("London & UK alumni")).toBe("LU");
    expect(initials("Batch of 2012 reunion")).toBe("BO");
    expect(initials("  weekend   runners ")).toBe("WR");
  });

  it("skips an emoji in front, whole, rather than splitting it", () => {
    for (const name of ["🏃 Morning runners", "🏃‍♀️ Morning runners", "☕ Morning runners", "❤️ Morning runners"]) expect(initials(name), name).toBe("MR");
    expect(initials("🎉🎉")).toBe("");
  });

  it("keeps names in any script", () => {
    expect(initials("मुंबई क्लब")).toBe("मक");
    expect(initials("Ölçek Ünal")).toBe("ÖÜ");
    expect(initials("2012 batch")).toBe("2B");
  });
});
