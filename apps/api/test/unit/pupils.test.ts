import { isCurrentPupil } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const school = (timezone = "Asia/Kolkata") => ({ type: "SCHOOL" as const, timezone });
const MID_2026 = new Date("2026-06-15T06:00:00.000Z");

describe("isCurrentPupil", () => {
  describe("rule 1: a future batch year", () => {
    it("counts, whatever the date of birth says", () => {
      expect(isCurrentPupil(school(), { batchYear: 2027, dateOfBirth: null }, MID_2026)).toBe(true);
      expect(isCurrentPupil(school(), { batchYear: 2027, dateOfBirth: "1980-01-01" }, MID_2026)).toBe(true);
      expect(isCurrentPupil(school(), { batchYear: 2040, dateOfBirth: "2012-01-01" }, MID_2026)).toBe(true);
    });
  });

  describe("rule 2: a date of birth under 18", () => {
    it("counts, even in a past batch year", () => {
      expect(isCurrentPupil(school(), { batchYear: 2020, dateOfBirth: "2010-01-01" }, MID_2026)).toBe(true);
    });

    it("stops on the 18th birthday, and not the day before", () => {
      const born = "2008-06-15";
      expect(isCurrentPupil(school(), { batchYear: 2020, dateOfBirth: born }, new Date("2026-06-14T06:00:00.000Z"))).toBe(true);
      expect(isCurrentPupil(school(), { batchYear: 2020, dateOfBirth: born }, new Date("2026-06-15T06:00:00.000Z"))).toBe(false);
      expect(isCurrentPupil(school(), { batchYear: 2020, dateOfBirth: born }, new Date("2026-06-16T06:00:00.000Z"))).toBe(false);
    });

    it("compares the whole date, not just the year", () => {
      expect(isCurrentPupil(school(), { batchYear: 2020, dateOfBirth: "2008-12-31" }, MID_2026)).toBe(true);
      expect(isCurrentPupil(school(), { batchYear: 2020, dateOfBirth: "2008-01-01" }, MID_2026)).toBe(false);
    });

    it("has someone born on 29 February turn 18 on 1 March in a common year, on the side of caution", () => {
      const born = "2008-02-29";
      expect(isCurrentPupil(school(), { batchYear: 2020, dateOfBirth: born }, new Date("2026-02-28T12:00:00.000Z"))).toBe(true);
      expect(isCurrentPupil(school(), { batchYear: 2020, dateOfBirth: born }, new Date("2026-03-01T12:00:00.000Z"))).toBe(false);
    });

    it("takes the 18th birthday on 29 February in a leap year", () => {
      const born = "2010-02-28";
      expect(isCurrentPupil(school(), { batchYear: 2020, dateOfBirth: born }, new Date("2028-02-27T12:00:00.000Z"))).toBe(true);
      expect(isCurrentPupil(school(), { batchYear: 2020, dateOfBirth: born }, new Date("2028-02-28T12:00:00.000Z"))).toBe(false);
    });
  });

  describe("rule 3: this year's batch with no date of birth", () => {
    it("counts, because they may still be at school", () => {
      expect(isCurrentPupil(school(), { batchYear: 2026, dateOfBirth: null }, MID_2026)).toBe(true);
    });

    it("is lifted by a date of birth showing 18 or over", () => {
      expect(isCurrentPupil(school(), { batchYear: 2026, dateOfBirth: "2000-01-01" }, MID_2026)).toBe(false);
      expect(isCurrentPupil(school(), { batchYear: 2026, dateOfBirth: "2008-06-15" }, new Date("2026-06-15T06:00:00.000Z"))).toBe(false);
    });

    it("isn't lifted by a date of birth under 18", () => {
      expect(isCurrentPupil(school(), { batchYear: 2026, dateOfBirth: "2009-01-01" }, MID_2026)).toBe(true);
    });
  });

  it("doesn't count a past batch with no date of birth", () => {
    expect(isCurrentPupil(school(), { batchYear: 2025, dateOfBirth: null }, MID_2026)).toBe(false);
  });

  it("reads a blank batch year as neither future nor current, leaving the date of birth to decide", () => {
    expect(isCurrentPupil(school(), { batchYear: null, dateOfBirth: null }, MID_2026)).toBe(false);
    expect(isCurrentPupil(school(), { batchYear: null, dateOfBirth: "2000-01-01" }, MID_2026)).toBe(false);
    expect(isCurrentPupil(school(), { batchYear: null, dateOfBirth: "2012-01-01" }, MID_2026)).toBe(true);
  });

  it("applies to schools only", () => {
    for (const type of ["UNIVERSITY", "COLLEGE", "OTHER"] as const) {
      expect(isCurrentPupil({ type, timezone: "Asia/Kolkata" }, { batchYear: 2030, dateOfBirth: "2015-01-01" }, MID_2026), type).toBe(false);
    }
  });

  describe("in the institution's time zone", () => {
    /** 20:00 UTC on New Year's Eve: already 2028 in Kolkata, still 2027 in New York. */
    const NEW_YEARS_EVE = new Date("2027-12-31T20:00:00.000Z");

    it("moves the batch year rule over at the school's midnight", () => {
      const member = { batchYear: 2027, dateOfBirth: null };
      expect(isCurrentPupil(school("Asia/Kolkata"), member, NEW_YEARS_EVE)).toBe(false);
      expect(isCurrentPupil(school("America/New_York"), member, NEW_YEARS_EVE)).toBe(true);
    });

    it("treats next year's batch as future until the school's new year, and current after", () => {
      const member = { batchYear: 2028, dateOfBirth: "2000-01-01" };
      // Past 18 in both: only the batch year can make them a pupil, and only where 2028 hasn't started.
      expect(isCurrentPupil(school("Asia/Kolkata"), member, NEW_YEARS_EVE)).toBe(false);
      expect(isCurrentPupil(school("America/New_York"), member, NEW_YEARS_EVE)).toBe(true);
    });

    it("moves the 18th birthday over at the school's midnight", () => {
      const member = { batchYear: 2020, dateOfBirth: "2010-01-01" };
      expect(isCurrentPupil(school("Asia/Kolkata"), member, NEW_YEARS_EVE)).toBe(false);
      expect(isCurrentPupil(school("America/New_York"), member, NEW_YEARS_EVE)).toBe(true);
    });

    it("handles the far ends of the map on the same instant", () => {
      const member = { batchYear: 2026, dateOfBirth: null };
      const instant = new Date("2026-12-31T23:30:00.000Z");
      expect(isCurrentPupil(school("Pacific/Kiritimati"), member, instant)).toBe(false);
      expect(isCurrentPupil(school("Pacific/Pago_Pago"), member, instant)).toBe(true);
    });
  });
});
