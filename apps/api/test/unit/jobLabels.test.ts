import { applicationsClosed, applicationsLine, experienceLabel, jobFacts, jobIsOpen, jobPlaceLabel, jobSalaryText, toMinor, type JobFactsSource } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const NOW = Date.parse("2026-11-04T06:30:00Z");

describe("jobIsOpen", () => {
  const open = { moderationStatus: "APPROVED" as const, isClosed: false, expiresAt: null };

  it("is open while published, not closed and before its closing date", () => {
    expect(jobIsOpen(open, NOW)).toBe(true);
    expect(jobIsOpen({ ...open, expiresAt: "2026-11-04T06:30:00.001Z" }, NOW)).toBe(true);
    expect(jobIsOpen({ ...open, isClosed: true }, NOW)).toBe(false);
    expect(jobIsOpen({ ...open, moderationStatus: "PENDING" }, NOW)).toBe(false);
    expect(jobIsOpen({ ...open, moderationStatus: "REJECTED" }, NOW)).toBe(false);
    expect(jobIsOpen({ ...open, moderationStatus: "REMOVED" }, NOW)).toBe(false);
  });

  it("closes at its closing date exactly, from a row's Date or a DTO's string, against a number or a Date", () => {
    expect(jobIsOpen({ ...open, expiresAt: "2026-11-04T06:30:00Z" }, NOW)).toBe(false);
    expect(jobIsOpen({ ...open, expiresAt: new Date(NOW) }, new Date(NOW))).toBe(false);
    expect(jobIsOpen({ ...open, expiresAt: new Date(NOW + 1) }, new Date(NOW))).toBe(true);
    expect(jobIsOpen({ ...open, expiresAt: new Date(NOW - 86_400_000) }, NOW)).toBe(false);
  });
});

describe("applicationsClosed", () => {
  it("is true once the poster closed the job or its closing date passed, whatever its review", () => {
    expect(applicationsClosed({ isClosed: false, expiresAt: null }, NOW)).toBe(false);
    expect(applicationsClosed({ isClosed: false, expiresAt: "2026-11-04T06:30:00.001Z" }, NOW)).toBe(false);
    expect(applicationsClosed({ isClosed: false, expiresAt: "2026-11-04T06:30:00Z" }, NOW)).toBe(true);
    expect(applicationsClosed({ isClosed: false, expiresAt: new Date(NOW - 1) }, new Date(NOW))).toBe(true);
    expect(applicationsClosed({ isClosed: true, expiresAt: null }, NOW)).toBe(true);
  });

  it("leaves a job still in review taking applications, which jobIsOpen doesn't", () => {
    const pending = { moderationStatus: "PENDING" as const, isClosed: false, expiresAt: null };
    expect(applicationsClosed(pending, NOW)).toBe(false);
    expect(jobIsOpen(pending, NOW)).toBe(false);
  });
});

describe("jobSalaryText", () => {
  it("writes the pay range, and nothing when the job gives no amount", () => {
    const pay = { salaryMinMinor: toMinor(2_500_000, "INR"), salaryMaxMinor: toMinor(4_000_000, "INR"), salaryCurrency: "INR" as const, salaryPeriod: "YEAR" as const };
    expect(jobSalaryText(pay)).toBe("₹25–40 LPA");
    expect(jobSalaryText({ ...pay, salaryMaxMinor: null })).toBe("From ₹25 LPA");
    expect(jobSalaryText({ ...pay, salaryMinMinor: null, salaryMaxMinor: null })).toBeNull();
  });
});

describe("jobPlaceLabel", () => {
  it("is the location, with the work mode after it unless the job is on-site", () => {
    expect(jobPlaceLabel({ workMode: "ON_SITE", location: "Mumbai" })).toBe("Mumbai");
    expect(jobPlaceLabel({ workMode: "HYBRID", location: "London" })).toBe("London · Hybrid");
    expect(jobPlaceLabel({ workMode: "REMOTE", location: "Mumbai" })).toBe("Mumbai · Remote");
  });

  it("is the work mode alone without a location, and nothing for an on-site job without one", () => {
    expect(jobPlaceLabel({ workMode: "REMOTE", location: null })).toBe("Remote");
    expect(jobPlaceLabel({ workMode: "HYBRID", location: "  " })).toBe("Hybrid");
    expect(jobPlaceLabel({ workMode: "ON_SITE", location: null })).toBeNull();
    expect(jobPlaceLabel({ workMode: "ON_SITE", location: " " })).toBeNull();
  });

  it("reads in the digest as it always has", () => {
    const meta = (job: { companyName: string; workMode: "ON_SITE" | "HYBRID" | "REMOTE"; location: string | null }) => [job.companyName, jobPlaceLabel(job)].filter(Boolean).join(" · ");
    expect(meta({ companyName: "Zylo", workMode: "REMOTE", location: null })).toBe("Zylo · Remote");
    expect(meta({ companyName: "Zylo", workMode: "ON_SITE", location: null })).toBe("Zylo");
  });
});

describe("experienceLabel", () => {
  it("reads a range, an open top, an open bottom and a single value", () => {
    expect(experienceLabel(3, 6)).toBe("3–6 years");
    expect(experienceLabel(0, 2)).toBe("0–2 years");
    expect(experienceLabel(3, null)).toBe("3+ years");
    expect(experienceLabel(1, undefined)).toBe("1+ years");
    expect(experienceLabel(null, 2)).toBe("Up to 2 years");
    expect(experienceLabel(null, 1)).toBe("Up to 1 year");
    expect(experienceLabel(4, 4)).toBe("4 years");
    expect(experienceLabel(1, 1)).toBe("1 year");
  });

  it("welcomes freshers when no experience is needed, and says nothing when the job doesn't", () => {
    expect(experienceLabel(0, null)).toBe("Open to freshers");
    expect(experienceLabel(0, 0)).toBe("Open to freshers");
    expect(experienceLabel(null, 0)).toBe("Open to freshers");
    expect(experienceLabel(null, null)).toBeNull();
    expect(experienceLabel(undefined, undefined)).toBeNull();
  });
});

describe("jobFacts", () => {
  const bare: JobFactsSource = {
    jobType: "FULL_TIME",
    workMode: "ON_SITE",
    location: null,
    salaryMinMinor: null,
    salaryMaxMinor: null,
    salaryCurrency: "INR",
    salaryPeriod: "YEAR",
    salaryNote: null,
    experienceMin: null,
    experienceMax: null,
    seniority: null,
  };

  it("lists every fact a full job gives, in order, with its label", () => {
    const facts = jobFacts({
      ...bare,
      workMode: "REMOTE",
      location: "Mumbai",
      salaryMinMinor: toMinor(2_500_000, "INR"),
      salaryMaxMinor: toMinor(4_000_000, "INR"),
      salaryNote: "Plus ESOPs",
      experienceMin: 3,
      experienceMax: 6,
      seniority: "MID",
      openings: 2,
      educationRequirement: "Any engineering degree",
    });
    expect(facts).toEqual([
      { key: "jobType", label: "Job type", value: "Full time" },
      { key: "workMode", label: "Work mode", value: "Remote" },
      { key: "location", label: "Location", value: "Mumbai" },
      { key: "salary", label: "Salary", value: "₹25–40 LPA" },
      { key: "salaryNote", label: "Pay note", value: "Plus ESOPs" },
      { key: "experience", label: "Experience", value: "3–6 years" },
      { key: "seniority", label: "Seniority", value: "Mid level" },
      { key: "openings", label: "Openings", value: "2" },
      { key: "education", label: "Education", value: "Any engineering degree" },
    ]);
  });

  it("leaves out what the job doesn't say, so a card (with no openings or education) gives only the type and work mode", () => {
    expect(jobFacts(bare)).toEqual([
      { key: "jobType", label: "Job type", value: "Full time" },
      { key: "workMode", label: "Work mode", value: "On-site" },
    ]);
    expect(jobFacts({ ...bare, openings: null, educationRequirement: null }).map((f) => f.key)).toEqual(["jobType", "workMode"]);
  });

  it("calls an internship's pay its stipend", () => {
    const facts = jobFacts({ ...bare, jobType: "INTERNSHIP", salaryMinMinor: toMinor(25_000, "INR"), salaryMaxMinor: toMinor(35_000, "INR"), salaryPeriod: "MONTH", experienceMin: 0 });
    expect(facts).toContainEqual({ key: "salary", label: "Stipend", value: "₹25,000–35,000/mo" });
    expect(facts).toContainEqual({ key: "experience", label: "Experience", value: "Open to freshers" });
  });

  it("gives the pay note alone when there's no amount", () => {
    expect(jobFacts({ ...bare, salaryNote: "₹25–40 LPA" }).filter((f) => f.key.startsWith("salary"))).toEqual([{ key: "salaryNote", label: "Pay note", value: "₹25–40 LPA" }]);
  });
});

describe("applicationsLine", () => {
  it("says when an open job's applications close, in the time zone given", () => {
    expect(applicationsLine({ isClosed: false, expiresAt: "2026-12-12T12:00:00Z" }, NOW, "Asia/Kolkata")).toBe("Applications close 12 Dec");
    // 20:00 UTC on 11 December is already the 12th in India.
    expect(applicationsLine({ isClosed: false, expiresAt: "2026-12-11T20:00:00Z" }, NOW, "Asia/Kolkata")).toBe("Applications close 12 Dec");
    expect(applicationsLine({ isClosed: false, expiresAt: "2026-12-11T20:00:00Z" }, NOW, "UTC")).toBe("Applications close 11 Dec");
  });

  it("names the year only when it isn't this one", () => {
    expect(applicationsLine({ isClosed: false, expiresAt: "2027-01-05T12:00:00Z" }, NOW, "UTC")).toBe("Applications close 5 Jan 2027");
    expect(applicationsLine({ isClosed: false, expiresAt: "2025-11-03T12:00:00Z" }, NOW, "UTC")).toBe("Applications closed 3 Nov 2025");
  });

  it("says applications closed on the date that passed, and with no date once the poster closed it", () => {
    expect(applicationsLine({ isClosed: false, expiresAt: "2026-11-03T12:00:00Z" }, NOW, "UTC")).toBe("Applications closed 3 Nov");
    expect(applicationsLine({ isClosed: false, expiresAt: new Date(NOW).toISOString() }, NOW, "UTC")).toBe("Applications closed 4 Nov");
    expect(applicationsLine({ isClosed: true, expiresAt: "2026-12-12T12:00:00Z" }, NOW, "UTC")).toBe("Applications closed");
    expect(applicationsLine({ isClosed: true, expiresAt: null }, NOW)).toBe("Applications closed");
  });

  it("says nothing for an open job with no closing date", () => {
    expect(applicationsLine({ isClosed: false, expiresAt: null }, NOW)).toBeNull();
  });

  it("falls back to UTC for a time zone it doesn't know", () => {
    expect(applicationsLine({ isClosed: false, expiresAt: "2026-12-11T20:00:00Z" }, NOW, "Not/AZone")).toBe("Applications close 11 Dec");
  });
});
