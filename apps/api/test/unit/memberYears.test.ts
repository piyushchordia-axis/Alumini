import {
  MEMBER_START_MIN_YEAR,
  invitationYearsLabel,
  memberEndYearOptions,
  memberStartYearOptions,
  memberYearFields,
  memberYearsIssues,
  memberYearsLabel,
  memberYearsLine,
  membershipProfileSchema,
  membershipProfileUpdateSchema,
  type TenantType,
} from "@illuminize/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const rules = (type: TenantType, minBatchYear = 1990, maxBatchYear = 2032) => ({ type, settings: { minBatchYear, maxBatchYear } });
// Local time, as the checks read the year with getFullYear.
const MID_2026 = new Date(2026, 5, 15, 12);

describe("memberYearsLabel", () => {
  it("writes the years with an en dash, one year once, and an open end as present", () => {
    expect(memberYearsLabel({ startYear: 2020, batchYear: 2024 })).toBe("2020–2024");
    expect(memberYearsLabel({ startYear: 2020, batchYear: 2020 })).toBe("2020");
    expect(memberYearsLabel({ startYear: 1996, batchYear: null })).toBe("1996–present");
    expect(memberYearsLabel({ startYear: 1996 })).toBe("1996–present");
  });

  it("gives a pupil's end year ahead as it is", () => {
    expect(memberYearsLabel({ startYear: 2018, batchYear: 2030 })).toBe("2018–2030");
  });

  it("falls back to the end year, or nothing, without a start", () => {
    expect(memberYearsLabel({ startYear: null, batchYear: 2012 })).toBe("2012");
    expect(memberYearsLabel({ batchYear: 2012 })).toBe("2012");
    expect(memberYearsLabel({})).toBe("");
  });
});

describe("memberYearsLine", () => {
  it("puts the years first and leaves blank parts out", () => {
    expect(memberYearsLine({ startYear: 2020, batchYear: 2024 }, "Infosys")).toBe("2020–2024 · Infosys");
    expect(memberYearsLine({ startYear: 2020, batchYear: 2024 }, null, "", undefined, false, "Pune")).toBe("2020–2024 · Pune");
    expect(memberYearsLine({ startYear: 1996, batchYear: null })).toBe("1996–present");
    expect(memberYearsLine({}, "Infosys")).toBe("Infosys");
  });
});

describe("memberYearFields", () => {
  it("asks when they joined and left, both required, at a school, college or university", () => {
    for (const type of ["SCHOOL", "COLLEGE", "UNIVERSITY"] as const) {
      expect(memberYearFields(type)).toEqual({
        start: { label: "Year you joined", blank: "Choose a year" },
        end: { label: "Year you left (or will leave)", blank: "Choose a year", required: true },
      });
    }
  });

  it("asks since when at a community, with an optional end whose blank means still a member", () => {
    expect(memberYearFields("OTHER")).toEqual({
      start: { label: "Member since", blank: "Choose a year" },
      end: { label: "Until (leave blank if you still are)", blank: "Still a member", required: false },
    });
  });
});

describe("memberYearsIssues", () => {
  const now = MID_2026;

  it("takes years in order within the bounds", () => {
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: 2008, batchYear: 2012 }, { now })).toEqual({});
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: 2012, batchYear: 2012 }, { now })).toEqual({});
    expect(memberYearsIssues(rules("SCHOOL"), { startYear: 2020, batchYear: 2030 }, { now })).toEqual({});
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: MEMBER_START_MIN_YEAR, batchYear: 1990 }, { now })).toEqual({});
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: 2026, batchYear: 2032 }, { now })).toEqual({});
  });

  it("requires a start everywhere, and an end except at a community", () => {
    expect(memberYearsIssues(rules("COLLEGE"), {}, { now })).toEqual({ startYear: "Enter the year you joined", batchYear: "Enter the year you left, or will leave" });
    expect(memberYearsIssues(rules("COLLEGE"), { startYear: null, batchYear: null }, { now })).toEqual({
      startYear: "Enter the year you joined",
      batchYear: "Enter the year you left, or will leave",
    });
    expect(memberYearsIssues(rules("OTHER"), {}, { now })).toEqual({ startYear: "Enter the year you joined" });
    expect(memberYearsIssues(rules("OTHER"), { startYear: 1996, batchYear: null }, { now })).toEqual({});
  });

  it("keeps the start from MEMBER_START_MIN_YEAR to this year", () => {
    expect(memberYearsIssues(rules("OTHER"), { startYear: MEMBER_START_MIN_YEAR - 1 }, { now })).toEqual({ startYear: "Use a year from 1930 on" });
    expect(memberYearsIssues(rules("OTHER"), { startYear: 2027 }, { now })).toEqual({ startYear: "This year at the latest" });
    expect(memberYearsIssues(rules("OTHER"), { startYear: 2010.5 }, { now })).toEqual({ startYear: "Enter a year" });
    expect(memberYearsIssues(rules("OTHER"), { startYear: Number.NaN }, { now })).toEqual({ startYear: "Enter a year" });
  });

  it("keeps the end within the institution's batch range", () => {
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: 1980, batchYear: 1989 }, { now })).toEqual({ batchYear: "Must be between 1990 and 2032" });
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: 2020, batchYear: 2033 }, { now })).toEqual({ batchYear: "Must be between 1990 and 2032" });
    expect(memberYearsIssues(rules("OTHER"), { startYear: 1980, batchYear: 1985 }, { now })).toEqual({ batchYear: "Must be between 1990 and 2032" });
  });

  it("doesn't let a community's end be in the future, as a pupil's may be", () => {
    expect(memberYearsIssues(rules("OTHER"), { startYear: 2010, batchYear: 2027 }, { now })).toEqual({ batchYear: "Leave this blank if you still are" });
    expect(memberYearsIssues(rules("OTHER"), { startYear: 2010, batchYear: 2026 }, { now })).toEqual({});
    expect(memberYearsIssues(rules("SCHOOL"), { startYear: 2020, batchYear: 2027 }, { now })).toEqual({});
  });

  it("refuses an end before the start, on the end", () => {
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: 2012, batchYear: 2008 }, { now })).toEqual({ batchYear: "Can't be before the year you joined" });
    expect(memberYearsIssues(rules("OTHER"), { startYear: 2012, batchYear: 2008 }, { now })).toEqual({ batchYear: "Can't be before the year you joined" });
    // A start that is itself wrong is reported alone.
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: 2030, batchYear: 2028 }, { now })).toEqual({ startYear: "This year at the latest" });
  });

  it("checks only what's given when not required, as for an invitation", () => {
    const loose = { now, required: false };
    expect(memberYearsIssues(rules("UNIVERSITY"), {}, loose)).toEqual({});
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: 2008 }, loose)).toEqual({});
    expect(memberYearsIssues(rules("UNIVERSITY"), { batchYear: 2012 }, loose)).toEqual({});
    expect(memberYearsIssues(rules("UNIVERSITY"), { batchYear: 1989 }, loose)).toEqual({ batchYear: "Must be between 1990 and 2032" });
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: 2027 }, loose)).toEqual({ startYear: "This year at the latest" });
    expect(memberYearsIssues(rules("UNIVERSITY"), { startYear: 2012, batchYear: 2008 }, loose)).toEqual({ batchYear: "Can't be before the year you joined" });
  });

  describe("at the turn of the year", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("reads this year when it checks, not before", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 11, 31, 23, 59));
      expect(memberYearsIssues(rules("OTHER"), { startYear: 2027 })).toEqual({ startYear: "This year at the latest" });
      expect(memberYearsIssues(rules("OTHER"), { startYear: 2020, batchYear: 2027 })).toEqual({ batchYear: "Leave this blank if you still are" });
      expect(memberStartYearOptions()[0]).toBe(2026);
      vi.setSystemTime(new Date(2027, 0, 1, 0, 1));
      expect(memberYearsIssues(rules("OTHER"), { startYear: 2027 })).toEqual({});
      expect(memberYearsIssues(rules("OTHER"), { startYear: 2020, batchYear: 2027 })).toEqual({});
      expect(memberStartYearOptions()[0]).toBe(2027);
    });
  });
});

describe("year options", () => {
  it("offers start years from this year back to MEMBER_START_MIN_YEAR, newest first", () => {
    const years = memberStartYearOptions(MID_2026);
    expect(years[0]).toBe(2026);
    expect(years.at(-1)).toBe(MEMBER_START_MIN_YEAR);
    expect(years).toHaveLength(2026 - MEMBER_START_MIN_YEAR + 1);
  });

  it("offers end years in the batch range, newest first, and no later than this year at a community", () => {
    expect(memberEndYearOptions(rules("SCHOOL", 2020, 2030), MID_2026)).toEqual([2030, 2029, 2028, 2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020]);
    expect(memberEndYearOptions(rules("OTHER", 2020, 2030), MID_2026)).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020]);
    expect(memberEndYearOptions(rules("OTHER", 2020, 2024), MID_2026)).toEqual([2024, 2023, 2022, 2021, 2020]);
    expect(memberEndYearOptions(rules("OTHER", 2027, 2030), MID_2026)).toEqual([]);
  });

  it("agrees with memberYearsIssues on every year it offers", () => {
    for (const type of ["UNIVERSITY", "OTHER"] as const) {
      for (const end of memberEndYearOptions(rules(type), MID_2026)) {
        expect(memberYearsIssues(rules(type), { startYear: Math.min(end, 2026), batchYear: end }, { now: MID_2026 })).toEqual({});
      }
    }
    for (const start of memberStartYearOptions(MID_2026)) expect(memberYearsIssues(rules("OTHER"), { startYear: start }, { now: MID_2026 })).toEqual({});
  });
});

describe("invitationYearsLabel", () => {
  it("writes either year alone, both, or nothing", () => {
    expect(invitationYearsLabel({ startYear: 2008, batchYear: 2012 })).toBe("2008–2012");
    expect(invitationYearsLabel({ startYear: 2008, batchYear: null })).toBe("From 2008");
    expect(invitationYearsLabel({ startYear: null, batchYear: 2012 })).toBe("2012");
    expect(invitationYearsLabel({ startYear: null, batchYear: null })).toBe("");
  });
});

describe("the profile schema's years", () => {
  const base = { fullName: "Asha Rao", professionType: "EMPLOYED" as const };
  const issuesOf = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
    Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));

  it("needs a start; an end may be left out or null", () => {
    expect(membershipProfileSchema.safeParse({ ...base, startYear: 2008, batchYear: 2012 }).success).toBe(true);
    expect(membershipProfileSchema.safeParse({ ...base, startYear: 2008, batchYear: null }).success).toBe(true);
    expect(membershipProfileSchema.safeParse({ ...base, startYear: 2008 }).success).toBe(true);
    expect(issuesOf(membershipProfileSchema.safeParse({ ...base, batchYear: 2012 }))).toHaveProperty("startYear");
  });

  it("doesn't read null or text as a year", () => {
    expect(issuesOf(membershipProfileSchema.safeParse({ ...base, startYear: null, batchYear: 2012 }))).toHaveProperty("startYear");
    expect(issuesOf(membershipProfileSchema.safeParse({ ...base, startYear: "2008", batchYear: 2012 }))).toHaveProperty("startYear");
    expect(issuesOf(membershipProfileSchema.safeParse({ ...base, startYear: 2008, batchYear: "2012" }))).toHaveProperty("batchYear");
  });

  it("refuses an end before the start, on registering and on an edit", () => {
    expect(issuesOf(membershipProfileSchema.safeParse({ ...base, startYear: 2012, batchYear: 2008 }))).toEqual({ batchYear: "Can't be before the year you joined" });
    expect(issuesOf(membershipProfileUpdateSchema.safeParse({ startYear: 2012, batchYear: 2008 }))).toEqual({ batchYear: "Can't be before the year you joined" });
  });

  it("says a year out of range only once, not also out of order, and takes no body that isn't an object", () => {
    expect(membershipProfileSchema.safeParse({ ...base, startYear: 1930, batchYear: 1900 }).error?.issues.map((i) => [i.path.join("."), i.message])).toEqual([["batchYear", "Use a year from 1950 on"]]);
    expect(membershipProfileUpdateSchema.safeParse({ startYear: 2030, batchYear: 2020 }).error?.issues.map((i) => i.path.join("."))).toEqual(["startYear"]);
    // Something wrong elsewhere doesn't hide years out of order.
    expect(issuesOf(membershipProfileSchema.safeParse({ ...base, fullName: "A", startYear: 2012, batchYear: 2008 }))).toHaveProperty("batchYear", "Can't be before the year you joined");
    expect(membershipProfileSchema.safeParse(null).success).toBe(false);
    expect(membershipProfileUpdateSchema.safeParse("2012").success).toBe(false);
  });

  it("leaves a year out of an edit alone, but never takes a null start", () => {
    const parsed = membershipProfileUpdateSchema.parse({ bio: "Hello" });
    expect(parsed).not.toHaveProperty("startYear");
    expect(parsed).not.toHaveProperty("batchYear");
    expect(membershipProfileUpdateSchema.parse({ batchYear: null })).toEqual({ batchYear: null });
    expect(issuesOf(membershipProfileUpdateSchema.safeParse({ startYear: null }))).toHaveProperty("startYear");
  });

  it("keeps the start from MEMBER_START_MIN_YEAR to this year", () => {
    const thisYear = new Date().getFullYear();
    expect(membershipProfileUpdateSchema.safeParse({ startYear: MEMBER_START_MIN_YEAR }).success).toBe(true);
    expect(membershipProfileUpdateSchema.safeParse({ startYear: thisYear }).success).toBe(true);
    expect(membershipProfileUpdateSchema.safeParse({ startYear: MEMBER_START_MIN_YEAR - 1 }).success).toBe(false);
    expect(membershipProfileUpdateSchema.safeParse({ startYear: thisYear + 1 }).success).toBe(false);
  });
});
