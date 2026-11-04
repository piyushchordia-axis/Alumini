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

  it("give back each link as the URL parser read it, as profile links, so a phone opens the site the page names", () => {
    for (const field of ["applyUrl", "companyWebsite", "companyLogoUrl"] as const) {
      // A browser reads a backslash before "@" as a "/", and iOS as part of a user name, which would make evil.example the host.
      expect(jobUpdateSchema.parse({ [field]: "https://careers.google.com\\@evil.example/apply" })[field], field).toBe("https://careers.google.com/@evil.example/apply");
      expect(jobCreateSchema.parse({ ...MINIMAL, [field]: " https://Zylo.example " })[field], field).toBe("https://zylo.example/");
      // A bidi control would show the address back to front to whoever reads it, a moderator too.
      expect(jobUpdateSchema.parse({ [field]: "https://zylo.example/‮gnp.exe" })[field], field).toBe("https://zylo.example/%E2%80%AEgnp.exe");
      expect(jobUpdateSchema.parse({ [field]: null })[field], field).toBeNull();
    }
    // A link already in that form is left as it is.
    for (const link of ["https://example.com/apply?ref=alumni@school#top", "http://careers.zylo.example/jobs/42/"]) expect(jobUpdateSchema.parse({ applyUrl: link }).applyUrl).toBe(link);
  });

  it("checks the 2048-character limit on a link as stored", () => {
    expect(jobUpdateSchema.safeParse({ applyUrl: `https://zylo.example/${"a".repeat(2020)}` }).success).toBe(true);
    // Each "é" is stored as "%C3%A9".
    const issues = jobUpdateSchema.safeParse({ applyUrl: `https://zylo.example/${"é".repeat(400)}` }).error?.issues;
    expect(issues?.map((i) => [i.path.join("."), i.message])).toEqual([["applyUrl", "Keep the link to 2048 characters"]]);
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
