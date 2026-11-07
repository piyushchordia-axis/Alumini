import { MY_CONTENT_SKELETONS, MY_CONTENT_TABS, SKELETON_LAYOUTS, SKELETON_SHAPES, skeletonWidth } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

describe("the skeleton layouts both apps draw", () => {
  it("cover every shape, and only those", () => {
    expect(Object.keys(SKELETON_LAYOUTS).sort()).toEqual([...SKELETON_SHAPES].sort());
  });

  it.each(SKELETON_SHAPES)("give %s at least one item, lines between 10%% and 100%% wide, and a lead that fits a 44pt row", (shape) => {
    const layout = SKELETON_LAYOUTS[shape];
    expect(Number.isInteger(layout.count) && layout.count >= 1).toBe(true);
    expect(layout.lines.length).toBeGreaterThan(0);
    for (const w of [...layout.lines, ...layout.body]) {
      expect(w).toBeGreaterThanOrEqual(10);
      expect(w).toBeLessThanOrEqual(100);
    }
    expect(Number.isInteger(layout.pills) && layout.pills >= 0).toBe(true);
    if (layout.lead) {
      expect(layout.lead.size).toBeGreaterThanOrEqual(32);
      expect(layout.lead.phoneSize).toBeGreaterThanOrEqual(32);
      // The phone's lead is never bigger than the web's: its screen is the narrower one.
      expect(layout.lead.phoneSize).toBeLessThanOrEqual(layout.lead.size);
    }
  });

  it("keep tables to header and cells: no lead, body or pills, in rows on one card", () => {
    for (const shape of SKELETON_SHAPES.filter((s) => SKELETON_LAYOUTS[s].table)) {
      const layout = SKELETON_LAYOUTS[shape];
      expect([shape, layout.lead, layout.body.length, layout.pills, layout.frame]).toEqual([shape, null, 0, 0, "rows"]);
      expect(layout.lines.length).toBeGreaterThanOrEqual(2);
    }
    expect(SKELETON_LAYOUTS.table.table).toBe(true);
  });

  it("draw the lists as the screens they stand for do", () => {
    // Directory cards sit two to a row on a wide screen, and lead with the member's photo.
    expect(SKELETON_LAYOUTS.member).toMatchObject({ columns: 2, frame: "cards", lead: { kind: "circle" } });
    // A post has its text and the reactions along its foot.
    expect(SKELETON_LAYOUTS.post.body.length).toBeGreaterThan(0);
    expect(SKELETON_LAYOUTS.post.pills).toBeGreaterThan(0);
    expect(SKELETON_LAYOUTS.event.lead?.kind).toBe("date");
    expect(SKELETON_LAYOUTS.listing.lead?.kind).toBe("square");
    // Notifications are rows in one card, with their time at the end; console rows end in an action.
    expect(SKELETON_LAYOUTS.notification).toMatchObject({ lead: null, trailing: "time", frame: "rows" });
    expect(SKELETON_LAYOUTS.adminRow.trailing).toBe("action");
  });
});

describe("a skeleton line's width", () => {
  it("is the same for the same line and row, so the outline doesn't jump between renders", () => {
    expect(skeletonWidth(60, 4)).toBe(skeletonWidth(60, 4));
  });

  it("shortens on each of three rows in turn, then starts again", () => {
    const widths = [0, 1, 2, 3, 4, 5].map((row) => skeletonWidth(80, row));
    expect(new Set(widths.slice(0, 3)).size).toBe(3);
    expect(widths.slice(3)).toEqual(widths.slice(0, 3));
    expect(widths[0]).toBe(80);
  });

  it("stays between 20% and 100%, whatever it is given", () => {
    expect(skeletonWidth(10, 0)).toBe(20);
    expect(skeletonWidth(25, 2)).toBe(20);
    expect(skeletonWidth(140, 0)).toBe(100);
    expect(skeletonWidth(80, -1)).toBe(skeletonWidth(80, 1));
    expect(skeletonWidth(80, 1.7)).toBe(skeletonWidth(80, 1));
  });
});

describe("My posts & listings", () => {
  it("outlines each tab in the shape of its own section's list", () => {
    expect(Object.keys(MY_CONTENT_SKELETONS).sort()).toEqual([...MY_CONTENT_TABS].sort());
    expect(MY_CONTENT_SKELETONS).toEqual({
      posts: "post",
      jobs: "listing",
      funding: "listing",
      businesses: "listing",
      groups: "row",
      events: "event",
      pastEvents: "event",
    });
    for (const tab of MY_CONTENT_TABS) expect(SKELETON_SHAPES).toContain(MY_CONTENT_SKELETONS[tab]);
  });
});
