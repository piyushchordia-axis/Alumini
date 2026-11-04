import { jobCreateSchema, jobListQuerySchema, jobUpdateSchema } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const MINIMAL = { title: "Backend Engineer", companyName: "Zylo", jobType: "FULL_TIME", description: "Build services with Node.js." };
const TEXT_FIELDS = ["location", "educationRequirement", "responsibilities", "requirements", "benefits", "howToApply", "contactPhone", "salaryNote", "aboutCompany"] as const;

describe("job schemas", () => {
  it("give back no field that wasn't sent, so an edit built from them never clears what its form doesn't show", () => {
    expect(Object.keys(jobCreateSchema.parse(MINIMAL)).sort()).toEqual(Object.keys(MINIMAL).sort());
    expect(jobUpdateSchema.parse({ title: "Renamed" })).toEqual({ title: "Renamed" });
  });

  it("clear an optional text field sent blank or null", () => {
    for (const field of TEXT_FIELDS) {
      expect(jobCreateSchema.parse({ ...MINIMAL, [field]: "   " })[field], field).toBeNull();
      expect(jobUpdateSchema.parse({ [field]: null })[field], field).toBeNull();
      expect(jobUpdateSchema.parse({ [field]: "  kept  " })[field], field).toBe("kept");
    }
  });

  it("refuse a link with a user name or password, or no host", () => {
    const linkIssue = (link: string) => {
      const issues = jobUpdateSchema.safeParse({ applyUrl: link }).error?.issues;
      return issues && [...new Set(issues.map((i) => i.path.join(".")))];
    };
    expect(linkIssue("https://careers.google.com@evil.example/apply")).toEqual(["applyUrl"]);
    expect(linkIssue("https://user:secret@example.com")).toEqual(["applyUrl"]);
    expect(linkIssue("http://")).toEqual(["applyUrl"]);
    expect(linkIssue("https://example.com/apply?ref=alumni@school")).toBeUndefined();
  });

  it("read a blank experience filter as no filter, not 0 years", () => {
    expect(jobListQuerySchema.parse({ experience: "" }).experience).toBeUndefined();
    expect(jobListQuerySchema.parse({ experience: "  " }).experience).toBeUndefined();
    expect(jobListQuerySchema.parse({}).experience).toBeUndefined();
    expect(jobListQuerySchema.parse({ experience: "0" }).experience).toBe(0);
    expect(jobListQuerySchema.parse({ experience: 4 }).experience).toBe(4);
    expect(jobListQuerySchema.safeParse({ experience: "four" }).success).toBe(false);
  });
});
