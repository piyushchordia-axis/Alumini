import { isValidCalendarDate, parseWallTime, utcToZonedWallTime, zonedWallTimeToUtc, zoneOffsetLabel } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

describe("time-zone helpers", () => {
  it("converts wall time in a zone to UTC regardless of the machine's zone", () => {
    expect(zonedWallTimeToUtc("2026-12-14T18:30", "Asia/Kolkata")).toBe("2026-12-14T13:00:00.000Z");
    expect(zonedWallTimeToUtc("2026-12-14T18:30", "Europe/London")).toBe("2026-12-14T18:30:00.000Z");
    expect(zonedWallTimeToUtc("2026-07-14T18:30", "Europe/London")).toBe("2026-07-14T17:30:00.000Z");
    expect(zonedWallTimeToUtc("2026-07-04T09:00", "America/New_York")).toBe("2026-07-04T13:00:00.000Z");
    expect(zonedWallTimeToUtc("2026-01-10T09:00", "Asia/Kathmandu")).toBe("2026-01-10T03:15:00.000Z");
  });

  it("round-trips through the zone", () => {
    for (const tz of ["Asia/Kolkata", "America/Los_Angeles", "Australia/Sydney", "UTC"]) {
      const iso = zonedWallTimeToUtc("2026-03-29T10:45", tz)!;
      expect(utcToZonedWallTime(iso, tz)).toBe("2026-03-29T10:45");
    }
  });

  it("handles DST gaps by moving forward", () => {
    // 2026-03-08 02:30 does not exist in New York (clocks jump 02:00 → 03:00)
    const iso = zonedWallTimeToUtc("2026-03-08T02:30", "America/New_York")!;
    expect(utcToZonedWallTime(iso, "America/New_York")).toBe("2026-03-08T03:30");
  });

  it("rejects malformed and impossible input", () => {
    expect(zonedWallTimeToUtc("2026-02-30T10:00", "Asia/Kolkata")).toBeNull();
    expect(zonedWallTimeToUtc("2026-02-10T24:30", "Asia/Kolkata")).toBeNull();
    expect(zonedWallTimeToUtc("nonsense", "Asia/Kolkata")).toBeNull();
    expect(zonedWallTimeToUtc("2026-02-10T10:00", "Mars/Olympus")).toBeNull();
    expect(parseWallTime("2026-02-10 10:00")).toEqual({ year: 2026, month: 2, day: 10, hour: 10, minute: 0 });
    expect(isValidCalendarDate("2024-02-29")).toBe(true);
    expect(isValidCalendarDate("2026-02-29")).toBe(false);
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
  });

  it("labels offsets", () => {
    expect(zoneOffsetLabel("Asia/Kolkata")).toBe("GMT+5:30");
    expect(zoneOffsetLabel("UTC")).toBe("GMT+0");
  });
});

describe("DST overlap", () => {
  it("picks the first occurrence of a repeated hour", () => {
    // 2026-11-01 01:30 happens twice in New York; the first is EDT (UTC-4)
    expect(zonedWallTimeToUtc("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });
});
