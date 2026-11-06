import {
  PORTABLE_PROFILE_KEYS,
  PROFILE_NUDGE_ITEMS,
  PROFILE_NUDGE_SNOOZE_DAYS,
  PROFILE_SECTIONS,
  PROFILE_STRENGTH_HIDE_AT,
  fillFromPortableProfile,
  hiddenProfileKeys,
  hostUrlSchema,
  initialAdminSchema,
  linkUrlSchema,
  membershipProfileSchema,
  membershipProfileUpdateSchema,
  missingProfileItems,
  portableProfileFillMessage,
  portableProfileOfferText,
  portableProfileUndoMessage,
  profileSectionFields,
  profileSectionOf,
  profileSectionOfStep,
  profileStepOf,
  profileStrength,
  profileYearsLabel,
  registrationStepHeading,
  showProfileNudge,
  socialUrlFromInput,
  sortEducation,
  sortExperiences,
  tenantSettingsUpdateSchema,
  undoPortableProfileFill,
  withoutHiddenProfileKeys,
  yearsOfExperience,
  yearsOfExperienceLabel,
  type PortableProfileDto,
  type ProfileStrengthInput,
} from "@illuminize/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-06-15T06:00:00.000Z");
const college = { type: "COLLEGE" as const, timezone: "Asia/Kolkata" };
const school = { type: "SCHOOL" as const, timezone: "Asia/Kolkata" };

const empty: ProfileStrengthInput = {
  avatarUrl: null,
  headline: null,
  companyName: null,
  designation: null,
  city: null,
  skills: [],
  bio: null,
  industry: null,
  careerStartYear: null,
  professionType: "EMPLOYED",
  batchYear: 2012,
  dateOfBirth: null,
  linkedinUrl: null,
  websiteUrl: null,
  githubUrl: null,
  instagramUrl: null,
  xUrl: null,
  degree: null,
  fieldOfStudy: null,
  experiences: [],
  education: [],
};

const complete: ProfileStrengthInput = {
  ...empty,
  avatarUrl: "https://cdn.example.com/a.jpg",
  headline: "Backend engineer",
  designation: "Engineer",
  city: "Pune",
  skills: ["Go", "SQL", "Kafka"],
  bio: "Hello",
  industry: "SOFTWARE_INTERNET",
  careerStartYear: 2014,
  githubUrl: "https://github.com/asha",
  degree: "B.Tech",
  experiences: [{ company: "Acme", title: "Intern", startYear: 2013, endYear: 2014 }],
};

describe("profileStrength", () => {
  it("weighs each item as the plan does, heaviest first, adding up to 100", () => {
    const { score, items } = profileStrength(empty, college, NOW);
    expect(score).toBe(0);
    expect(items.map((i) => [i.key, i.weight, i.section])).toEqual([
      ["photo", 20, "basics"],
      ["headline", 15, "work"],
      ["role", 10, "work"],
      ["city", 10, "basics"],
      ["skills", 10, "work"],
      ["bio", 10, "about"],
      ["industry", 5, "work"],
      ["careerStart", 5, "work"],
      ["link", 5, "about"],
      ["degree", 5, "about"],
      ["history", 5, "work"],
    ]);
    expect(items.every((i) => !i.done && i.label.length > 0)).toBe(true);
    expect(profileStrength(complete, college, NOW)).toMatchObject({ score: 100 });
  });

  it("scores the weight done out of the weight that applies", () => {
    expect(profileStrength({ ...empty, avatarUrl: "https://cdn.example.com/a.jpg" }, college, NOW).score).toBe(20);
    expect(profileStrength({ ...empty, avatarUrl: "x", headline: "y" }, college, NOW).score).toBe(35);
    // Blank text isn't done.
    expect(profileStrength({ ...empty, headline: "   ", city: "" }, college, NOW).score).toBe(0);
  });

  it("asks for three skills, and takes a company or a designation as the role, and past roles or studies as history", () => {
    const done = (m: Partial<ProfileStrengthInput>) => Object.fromEntries(profileStrength({ ...empty, ...m }, college, NOW).items.map((i) => [i.key, i.done]));
    expect(done({ skills: ["Go", "SQL"] }).skills).toBe(false);
    expect(done({ skills: ["Go", "SQL", "Rust"] }).skills).toBe(true);
    expect(done({ companyName: "Acme" }).role).toBe(true);
    expect(done({ designation: "CTO" }).role).toBe(true);
    expect(done({ education: [{ institution: "IIM", degree: "MBA", fieldOfStudy: null, startYear: null, endYear: null }] }).history).toBe(true);
    expect(done({ instagramUrl: "https://instagram.com/asha" }).link).toBe(true);
    expect(done({ fieldOfStudy: "Physics" }).degree).toBe(true);
  });

  it("leaves out the year they started working for students", () => {
    const { score, items } = profileStrength({ ...complete, professionType: "STUDENT", careerStartYear: null }, college, NOW);
    expect(items.map((i) => i.key)).not.toContain("careerStart");
    expect(score).toBe(100);
    expect(profileStrength({ ...empty, professionType: "STUDENT", avatarUrl: "x" }, college, NOW).score).toBe(21); // 20 of 95
  });

  it("leaves out a degree here at schools", () => {
    const { score, items } = profileStrength({ ...complete, degree: null }, school, NOW);
    expect(items.map((i) => i.key)).not.toContain("degree");
    expect(score).toBe(100);
  });

  it("leaves out links and the year they started working for a current pupil, but not for an alum of the same school", () => {
    const pupil = { ...complete, batchYear: 2028, careerStartYear: null, githubUrl: null, degree: null };
    const { score, items } = profileStrength(pupil, school, NOW);
    expect(items.map((i) => i.key)).toEqual(["photo", "headline", "role", "city", "skills", "bio", "industry", "history"]);
    expect(score).toBe(100);
    const alum = profileStrength({ ...pupil, batchYear: 2010 }, school, NOW);
    expect(alum.items.map((i) => i.key)).toEqual(expect.arrayContaining(["careerStart", "link"]));
    expect(alum.score).toBe(89); // 85 of 95
    // At a college a future batch is just a student still studying, not a pupil.
    expect(profileStrength(pupil, college, NOW).items.map((i) => i.key)).toContain("link");
  });
});

describe("showProfileNudge", () => {
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

  it("hides at PROFILE_STRENGTH_HIDE_AT and above", () => {
    expect(PROFILE_STRENGTH_HIDE_AT).toBe(90);
    expect(showProfileNudge(89, null, NOW)).toBe(true);
    expect(showProfileNudge(90, null, NOW)).toBe(false);
  });

  it("stays away for PROFILE_NUDGE_SNOOZE_DAYS after a dismissal", () => {
    expect(PROFILE_NUDGE_SNOOZE_DAYS).toBe(14);
    expect(showProfileNudge(40, daysAgo(0), NOW)).toBe(false);
    expect(showProfileNudge(40, daysAgo(13.9), NOW)).toBe(false);
    expect(showProfileNudge(40, daysAgo(14), NOW)).toBe(true);
  });
});

describe("profileStepOf", () => {
  const fields = [
    { key: "house", required: true, memberEditable: true },
    { key: "hostel", required: false, memberEditable: true },
    { key: "verified", required: true, memberEditable: false },
  ];

  it("puts each field in the step that holds it, nested paths included", () => {
    for (const path of ["avatarUrl", "fullName", "startYear", "batchYear", "professionType", "dateOfBirth", "city", "country"]) expect(profileStepOf(path)).toBe(1);
    for (const path of ["headline", "companyName", "designation", "industry", "careerStartYear", "skills.3", "experiences.1.endYear"]) expect(profileStepOf(path)).toBe(2);
    for (const path of ["bio", "interests", "degree", "fieldOfStudy", "education.0.institution", "linkedinUrl", "xUrl", "openTo", "maritalStatus", "kidsCount", "isPhoneVisible"])
      expect(profileStepOf(path)).toBe(3);
  });

  it("puts an institution's question in step 1 only when the member must answer it", () => {
    expect(profileStepOf("fields.house", fields)).toBe(1);
    expect(profileStepOf("fields.hostel", fields)).toBe(3);
    expect(profileStepOf("fields.verified", fields)).toBe(3); // only admins answer it
    expect(profileStepOf("fields.unknown", fields)).toBe(3);
    expect(profileSectionOf("fields.house", fields)).toBe("basics");
  });

  it("puts an unknown path in the first step, inherited names included", () => {
    expect(profileStepOf("")).toBe(1);
    expect(profileStepOf("somethingElse")).toBe(1);
    expect(profileStepOf("constructor")).toBe(1);
    expect(profileSectionOf("toString")).toBe("basics");
  });
});

describe("missingProfileItems", () => {
  it("suggests the heaviest items still missing, in the checklist's order on a tie", () => {
    const started = { ...empty, avatarUrl: "x", headline: "y", companyName: "Acme", city: "Pune" };
    expect(PROFILE_NUDGE_ITEMS).toBe(3);
    expect(missingProfileItems(profileStrength(started, college, NOW)).map((i) => i.key)).toEqual(["skills", "bio", "industry"]);
    expect(missingProfileItems(profileStrength(empty, college, NOW), 2).map((i) => i.key)).toEqual(["photo", "headline"]);
    expect(missingProfileItems(profileStrength({ ...complete, bio: null }, college, NOW)).map((i) => i.key)).toEqual(["bio"]);
    expect(missingProfileItems(profileStrength(complete, college, NOW))).toEqual([]);
  });
});

describe("registration steps", () => {
  it("names each step after its section", () => {
    expect([1, 2, 3].map((s) => registrationStepHeading(s as 1 | 2 | 3))).toEqual(["Step 1 of 3 · Basics", "Step 2 of 3 · Work", "Step 3 of 3 · About you"]);
    expect([1, 2, 3].map((s) => profileSectionOfStep(s as 1 | 2 | 3))).toEqual([...PROFILE_SECTIONS]);
  });

  it("lists each section's inputs, every input in exactly one, as profileSectionOf places them", () => {
    expect(profileSectionFields("basics").sort()).toEqual(["avatarUrl", "batchYear", "city", "country", "dateOfBirth", "fullName", "professionType", "startYear"]);
    expect(profileSectionFields("work").sort()).toEqual(["careerStartYear", "companyName", "designation", "experiences", "headline", "industry", "skills"]);
    const all = PROFILE_SECTIONS.flatMap((s) => profileSectionFields(s));
    expect(new Set(all).size).toBe(all.length);
    // Every key of the registration body but the institution's own questions.
    const body = Object.keys(membershipProfileSchema.shape).filter((k) => k !== "fields");
    expect([...all].sort()).toEqual(body.sort());
    for (const s of PROFILE_SECTIONS) for (const key of profileSectionFields(s)) expect(profileSectionOf(key), key).toBe(s);
    // Everything registration requires is in the first step, so the later ones can be skipped.
    const required = Object.entries(membershipProfileSchema.shape).filter(([, schema]) => !schema.safeParse(undefined).success).map(([key]) => key);
    expect(required.length).toBeGreaterThan(0);
    for (const key of required) expect(profileSectionOf(key), key).toBe("basics");
  });
});

describe("fillFromPortableProfile", () => {
  type Form = Partial<Record<(typeof PORTABLE_PROFILE_KEYS)[number] | "fullName", unknown>>;
  const start: Form = { fullName: "Asha Rao", city: null, country: "IN", headline: null, skills: [], experiences: [], bio: null, githubUrl: null, openTo: [] };
  const copy: Form = {
    city: "Pune",
    country: "US",
    headline: "Builds payments",
    skills: ["Go", "SQL"],
    experiences: [{ company: "Acme", title: "Intern", startYear: 2013, endYear: 2014 }],
    bio: null,
    githubUrl: "https://github.com/asha",
    openTo: ["HIRING"],
  };

  it("fills every input the member hasn't changed, including ones that only hold the form's default", () => {
    const fill = fillFromPortableProfile(copy, start, start);
    expect(fill.filled).toEqual(["city", "country", "headline", "skills", "experiences", "githubUrl", "openTo"]);
    expect(fill.kept).toEqual([]);
    expect(fill.values).toEqual({ city: "Pune", country: "US", headline: "Builds payments", skills: ["Go", "SQL"], experiences: copy.experiences, githubUrl: "https://github.com/asha", openTo: ["HIRING"] });
  });

  it("keeps what the member typed, and never clears an input the other profile leaves blank", () => {
    const typed = { ...start, city: "Mumbai", skills: ["Rust"], bio: "My own words" };
    const fill = fillFromPortableProfile(copy, typed, start);
    expect(fill.kept).toEqual(["city", "skills"]);
    expect(fill.values).not.toHaveProperty("city");
    expect(fill.values).not.toHaveProperty("skills");
    expect(fill.values).not.toHaveProperty("bio");
    expect(fill.filled).toContain("headline");
  });

  it("fills an input cleared back to blank, and passes over one that already matches", () => {
    const fill = fillFromPortableProfile(copy, { ...start, city: "  ", headline: "Builds payments", country: "US" }, start);
    expect(fill.filled).toContain("city");
    expect(fill.filled).not.toContain("headline");
    expect(fill.filled).not.toContain("country");
    expect(fill.kept).toEqual([]);
  });

  it("leaves alone the inputs the form hides", () => {
    const fill = fillFromPortableProfile(copy, start, start, ["githubUrl", "openTo", "careerStartYear"]);
    expect(fill.filled).not.toContain("githubUrl");
    expect(fill.filled).not.toContain("openTo");
    expect(fill.values).not.toHaveProperty("githubUrl");
  });

  it("covers every detail the API offers, and only those", () => {
    const offered: Record<Exclude<keyof PortableProfileDto, "source">, true> = {
      headline: true,
      companyName: true,
      designation: true,
      industry: true,
      careerStartYear: true,
      skills: true,
      experiences: true,
      education: true,
      linkedinUrl: true,
      websiteUrl: true,
      githubUrl: true,
      instagramUrl: true,
      xUrl: true,
      openTo: true,
      bio: true,
      interests: true,
      city: true,
      country: true,
      dateOfBirth: true,
    };
    expect([...PORTABLE_PROFILE_KEYS].sort()).toEqual(Object.keys(offered).sort());
  });

  it("says what it filled in and what it kept", () => {
    expect(portableProfileFillMessage("Demo University", { filled: ["city"], kept: [] })).toBe("Filled in your city from Demo University.");
    expect(portableProfileFillMessage("Demo University", { filled: ["city", "headline", "skills"], kept: [] })).toBe("Filled in your city, headline and skills from Demo University.");
    expect(portableProfileFillMessage("Demo University", { filled: ["city", "country", "headline", "skills", "bio"], kept: ["designation", "githubUrl"] })).toBe(
      "Filled in your city, country, headline and 2 more from Demo University. Kept what you'd entered for your role and GitHub.",
    );
    expect(portableProfileFillMessage("Demo University", { filled: [], kept: ["city"] })).toBe("Nothing new to add from Demo University. Kept what you'd entered for your city.");
  });

  it("names the date of birth in its offer only when it brings one", () => {
    expect(portableProfileOfferText({ dateOfBirth: "1990-04-02" })).toBe(
      "Bring over your city, date of birth, work, skills, links and bio from there. Nothing you've typed here is replaced, and you can change any of it.",
    );
    expect(portableProfileOfferText({ dateOfBirth: null })).toBe("Bring over your city, work, skills, links and bio from there. Nothing you've typed here is replaced, and you can change any of it.");
  });
});

describe("undoPortableProfileFill", () => {
  type Form = Partial<Record<(typeof PORTABLE_PROFILE_KEYS)[number], unknown>>;
  const before: Form = { city: null, headline: null, skills: [], experiences: [] };
  const copy: Form = { city: "Pune", headline: "Builds payments", skills: ["Go", "SQL"], experiences: [{ company: "Acme", title: "Intern", startYear: 2013, endYear: 2014 }] };
  const fill = fillFromPortableProfile(copy, before, before);

  it("puts back everything it filled while nothing has changed since", () => {
    const undo = undoPortableProfileFill(fill, before, { ...before, ...fill.values });
    expect(undo.values).toEqual(before);
    expect(undo.kept).toEqual([]);
    expect(portableProfileUndoMessage("Demo University", undo)).toBeNull();
  });

  it("keeps what the member changed after the fill, and says so", () => {
    const now = { ...before, ...fill.values, headline: "Head of payments at Acme", skills: ["Go", "SQL", "Rust"] };
    const undo = undoPortableProfileFill(fill, before, now);
    expect(undo.kept).toEqual(["headline", "skills"]);
    expect(undo.values).toEqual({ city: null, experiences: [] });
    expect(undo.values).not.toHaveProperty("headline");
    expect(portableProfileUndoMessage("Demo University", undo)).toBe("Took out the details from Demo University. Kept your changes to your headline and skills.");
  });

  it("counts a list row edited in place as a change, and an input cleared back to how it was as none", () => {
    const edited = [{ company: "Acme", title: "Intern", startYear: 2013, endYear: 2015 }];
    const undo = undoPortableProfileFill(fill, before, { ...before, ...fill.values, experiences: edited, city: "  " });
    expect(undo.kept).toEqual(["experiences"]);
    expect(undo.values).toHaveProperty("city", null);
  });
});

describe("hiddenProfileKeys", () => {
  const LINKS_AND_OPEN_TO = ["linkedinUrl", "websiteUrl", "githubUrl", "instagramUrl", "xUrl", "openTo"];
  const alum = { professionType: "EMPLOYED", batchYear: 2012, dateOfBirth: null };

  it("hides nothing from an alum outside a school", () => {
    expect(hiddenProfileKeys(college, alum, NOW)).toEqual([]);
  });

  it("hides the year they started working from a student, as the forms do", () => {
    expect(hiddenProfileKeys(college, { ...alum, professionType: "STUDENT" }, NOW)).toEqual(["careerStartYear"]);
  });

  it("hides degree and field of study at a school, and links and Open to from a current pupil there", () => {
    expect(hiddenProfileKeys(school, alum, NOW)).toEqual(["degree", "fieldOfStudy"]);
    expect(hiddenProfileKeys(school, { ...alum, batchYear: 2028 }, NOW)).toEqual(["degree", "fieldOfStudy", ...LINKS_AND_OPEN_TO]);
    // An adult in this year's batch has left school; a 15-year-old in an old batch hasn't.
    expect(hiddenProfileKeys(school, { ...alum, batchYear: 2026, dateOfBirth: "2000-01-01" }, NOW)).toEqual(["degree", "fieldOfStudy"]);
    expect(hiddenProfileKeys(school, { ...alum, batchYear: 2020, dateOfBirth: "2011-01-01" }, NOW)).toEqual(["degree", "fieldOfStudy", ...LINKS_AND_OPEN_TO]);
  });

  it("leaves out only those keys, so the schema neither checks nor sends what the member can't see", () => {
    const form = { fullName: "Naina Sen", startYear: 2022, batchYear: 2028, dateOfBirth: null, professionType: "STUDENT" as const, careerStartYear: 20, githubUrl: "my github", openTo: ["HIRING" as const], bio: "Hi" };
    const hidden = hiddenProfileKeys(school, form, NOW);
    const sent = withoutHiddenProfileKeys(form, hidden);
    expect(sent).toEqual({ fullName: "Naina Sen", startYear: 2022, batchYear: 2028, dateOfBirth: null, professionType: "STUDENT", bio: "Hi" });
    expect(form.githubUrl).toBe("my github"); // the form's own values are left alone
    // Unstripped, the hidden year and link would block the save with errors no input shows.
    expect(membershipProfileSchema.safeParse(form).success).toBe(false);
    const parsed = membershipProfileSchema.parse(sent);
    for (const key of hidden) expect(parsed).not.toHaveProperty(key);
    expect(withoutHiddenProfileKeys(form, [])).toBe(form);
  });
});

describe("sortExperiences and sortEducation", () => {
  const role = (company: string, startYear: number | null, endYear: number | null) => ({ company, title: "Engineer", startYear, endYear });

  it("puts the newest first by end year, then start year, with entries without years last and ties in their order", () => {
    const list = [role("blank", null, null), role("old", 2008, 2010), role("new", 2016, 2020), role("same end, later start", 2018, 2020), role("start only", 2021, null), role("blank 2", null, null)];
    expect(sortExperiences(list).map((r) => r.company)).toEqual(["start only", "same end, later start", "new", "old", "blank", "blank 2"]);
  });

  it("returns a new list and leaves the one given alone", () => {
    const list = [role("a", 2001, 2002), role("b", 2010, 2012)];
    const sorted = sortExperiences(list);
    expect(sorted.map((r) => r.company)).toEqual(["b", "a"]);
    expect(list.map((r) => r.company)).toEqual(["a", "b"]);
  });

  it("orders studies the same way", () => {
    const study = (institution: string, startYear: number | null, endYear: number | null) => ({ institution, degree: null, fieldOfStudy: null, startYear, endYear });
    expect(sortEducation([study("school", null, 2005), study("none", null, null), study("mba", 2012, 2014)]).map((e) => e.institution)).toEqual(["mba", "school", "none"]);
  });
});

describe("socialUrlFromInput", () => {
  it("turns a handle, with or without @, into the site's profile URL", () => {
    expect(socialUrlFromInput("github", "@asha-rao")).toBe("https://github.com/asha-rao");
    expect(socialUrlFromInput("github", " asha ")).toBe("https://github.com/asha");
    expect(socialUrlFromInput("x", "@asha_r")).toBe("https://x.com/asha_r");
    expect(socialUrlFromInput("instagram", "asha.rao")).toBe("https://www.instagram.com/asha.rao");
    expect(socialUrlFromInput("linkedin", "@asha-rao-123")).toBe("https://www.linkedin.com/in/asha-rao-123");
  });

  it("keeps a URL as typed, and adds https:// to one typed without it", () => {
    expect(socialUrlFromInput("linkedin", "https://www.linkedin.com/in/asha")).toBe("https://www.linkedin.com/in/asha");
    expect(socialUrlFromInput("x", "HTTP://twitter.com/asha")).toBe("HTTP://twitter.com/asha");
    expect(socialUrlFromInput("github", "github.com/asha")).toBe("https://github.com/asha");
    expect(socialUrlFromInput("linkedin", "www.linkedin.com/in/asha")).toBe("https://www.linkedin.com/in/asha");
    expect(socialUrlFromInput("website", "asha.dev")).toBe("https://asha.dev");
  });

  it("makes blank null and leaves anything else for the schema to refuse", () => {
    expect(socialUrlFromInput("website", "  ")).toBeNull();
    expect(socialUrlFromInput("github", null)).toBeNull();
    expect(socialUrlFromInput("website", "@asha")).toBe("@asha");
    expect(socialUrlFromInput("x", "not a handle!")).toBe("not a handle!");
    expect(socialUrlFromInput("x", "@far_too_long_for_x")).toBe("@far_too_long_for_x");
  });

  it("gives what the schema accepts for each kind", () => {
    const links = {
      linkedinUrl: socialUrlFromInput("linkedin", "@asha-rao"),
      githubUrl: socialUrlFromInput("github", "asha"),
      instagramUrl: socialUrlFromInput("instagram", "@asha.rao"),
      xUrl: socialUrlFromInput("x", "asha"),
      websiteUrl: socialUrlFromInput("website", "asha.dev/blog"),
    };
    expect(membershipProfileUpdateSchema.parse(links)).toEqual(links);
  });
});

describe("yearsOfExperience", () => {
  it("counts whole calendar years since they started, never below zero", () => {
    expect(yearsOfExperience(null, NOW)).toBeNull();
    expect(yearsOfExperience(undefined, NOW)).toBeNull();
    expect(yearsOfExperience(2015, NOW)).toBe(11);
    expect(yearsOfExperience(2026, NOW)).toBe(0);
    expect(yearsOfExperience(2030, NOW)).toBe(0);
  });

  it("is said in words, with the first year named rather than called zero years", () => {
    expect(yearsOfExperienceLabel(null, NOW)).toBeNull();
    expect(yearsOfExperienceLabel(2015, NOW)).toBe("11 years of experience");
    expect(yearsOfExperienceLabel(2025, NOW)).toBe("1 year of experience");
    expect(yearsOfExperienceLabel(2026, NOW)).toBe("Started working in 2026");
  });
});

describe("profileYearsLabel", () => {
  it("shows a range, a single year, or the one end that's known", () => {
    expect(profileYearsLabel(2015, 2019)).toBe("2015–2019");
    expect(profileYearsLabel(2019, 2019)).toBe("2019");
    expect(profileYearsLabel(2015, null)).toBe("From 2015");
    expect(profileYearsLabel(undefined, 2019)).toBe("Until 2019");
    expect(profileYearsLabel(null, null)).toBe("");
  });
});

describe("profile link schemas", () => {
  const linkedin = hostUrlSchema(["linkedin.com"]);
  const x = hostUrlSchema(["x.com", "twitter.com"]);

  it("judges a link by its hostname, so a mention of the site elsewhere in it doesn't pass", () => {
    expect(linkedin.safeParse("https://www.linkedin.com/in/asha").success).toBe(true);
    expect(linkedin.safeParse("https://in.linkedin.com/in/asha").success).toBe(true);
    expect(linkedin.safeParse("http://linkedin.com/in/asha").success).toBe(true);
    for (const bad of ["https://evil.com/?linkedin.com/", "https://evil.com/linkedin.com/in/asha", "https://notlinkedin.com/in/asha", "https://linkedin.com.evil.com/in/asha", "ftp://linkedin.com/in/asha"]) {
      expect(linkedin.safeParse(bad).success, bad).toBe(false);
    }
    expect(x.safeParse("https://x.com/asha").success).toBe(true);
    expect(x.safeParse("https://mobile.twitter.com/asha").success).toBe(true);
    expect(x.safeParse("https://xx.com/asha").success).toBe(false);
  });

  it("refuses a user name or password in any link", () => {
    expect(linkedin.safeParse("https://user:pass@www.linkedin.com/in/asha").success).toBe(false);
    expect(membershipProfileUpdateSchema.safeParse({ websiteUrl: "https://google.com@evil.com/" }).success).toBe(false);
    expect(membershipProfileUpdateSchema.safeParse({ websiteUrl: "https://asha.dev/" }).success).toBe(true);
  });

  it("takes URLs only: a handle is the form's to turn into one", () => {
    expect(membershipProfileUpdateSchema.safeParse({ githubUrl: "@asha" }).success).toBe(false);
    expect(membershipProfileUpdateSchema.safeParse({ xUrl: "asha" }).success).toBe(false);
  });

  it("gives back each link as the URL parser read it, which every app opening it reads the same way", () => {
    const stored = (body: Record<string, string>) => membershipProfileUpdateSchema.parse(body);
    // A browser reads a backslash before "@" as a "/", and iOS as part of a user name, which would make evil.com the host.
    for (const [kind, host] of [["linkedinUrl", "linkedin.com"], ["githubUrl", "github.com"], ["xUrl", "x.com"], ["instagramUrl", "www.instagram.com"], ["websiteUrl", "asha.dev"]] as const) {
      expect(stored({ [kind]: `https://${host}\\@evil.com` })[kind], kind).toBe(`https://${host}/@evil.com`);
    }
    expect(stored({ linkedinUrl: "https://www.linkedin.com\\@evil.com/in/x" }).linkedinUrl).toBe("https://www.linkedin.com/@evil.com/in/x");
    // The host in lower case, a bare host ending in "/", and bidi controls, spaces and other non-ASCII text encoded.
    expect(stored({ githubUrl: "https://GitHub.COM/Asha" }).githubUrl).toBe("https://github.com/Asha");
    expect(stored({ websiteUrl: " https://asha.dev " }).websiteUrl).toBe("https://asha.dev/");
    expect(stored({ websiteUrl: "https://asha.dev/‮exe.pdf my cv" }).websiteUrl).toBe("https://asha.dev/%E2%80%AEexe.pdf%20my%20cv");
    // A link already in that form is left as it is.
    for (const url of ["https://www.linkedin.com/in/asha", "https://github.com/asha?tab=repositories#top", "http://blog.asha.dev/about/"]) {
      expect(linkUrlSchema.parse(url)).toBe(url);
    }
  });

  it("checks the 500-character limit on the link as stored", () => {
    expect(linkUrlSchema.safeParse(`https://asha.dev/${"a".repeat(480)}`).success).toBe(true);
    // Each "é" is stored as "%C3%A9".
    expect(linkUrlSchema.safeParse(`https://asha.dev/${"é".repeat(100)}`).success).toBe(false);
  });
});

describe("profile schema", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks years against the year when it parses, not when it loaded", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Each is refused in 2026 and taken in 2027: a career's start, the year a member joined, an end ten years ahead, an
    // institution's latest batch, and a new admin's start and end.
    const checks = (year: number) => [
      membershipProfileUpdateSchema.safeParse({ careerStartYear: year }).success,
      membershipProfileUpdateSchema.safeParse({ startYear: year }).success,
      membershipProfileSchema.safeParse({ fullName: "Asha Rao", startYear: 2020, batchYear: year + 10, professionType: "EMPLOYED" }).success,
      tenantSettingsUpdateSchema.safeParse({ maxBatchYear: year + 10 }).success,
      initialAdminSchema.safeParse({ phone: "+919811111111", fullName: "First Admin", startYear: year }).success,
      initialAdminSchema.safeParse({ phone: "+919811111111", fullName: "First Admin", batchYear: year + 10 }).success,
    ];
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    expect(checks(2027)).toEqual([false, false, false, false, false, false]);
    vi.setSystemTime(new Date("2027-06-01T00:00:00Z"));
    expect(checks(2027)).toEqual([true, true, true, true, true, true]);
  });

  it("lets studies elsewhere end up to ten years ahead, and nothing start before 1940", () => {
    const year = new Date().getFullYear();
    const study = (endYear: number) => ({ education: [{ institution: "IIM", endYear }] });
    expect(membershipProfileUpdateSchema.safeParse(study(year + 10)).success).toBe(true);
    expect(membershipProfileUpdateSchema.safeParse(study(year + 11)).success).toBe(false);
    expect(membershipProfileUpdateSchema.safeParse({ experiences: [{ company: "Acme", title: "Clerk", startYear: 1939 }] }).success).toBe(false);
    expect(membershipProfileUpdateSchema.safeParse({ experiences: [{ company: "Acme", title: "Clerk", endYear: year + 1 }] }).success).toBe(false);
  });

  it("points an end before the start at the item's end year, and fills blank years with null", () => {
    const result = membershipProfileUpdateSchema.safeParse({ experiences: [{ company: "A", title: "B" }, { company: "C", title: "D", startYear: 2015, endYear: 2012 }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toEqual(["experiences.1.endYear"]);
    expect(membershipProfileUpdateSchema.parse({ experiences: [{ company: " A ", title: "B", extra: 1 }] }).experiences).toEqual([{ company: "A", title: "B", startYear: null, endYear: null }]);
    expect(membershipProfileUpdateSchema.parse({ education: [{ institution: "IIM", degree: "" }] }).education).toEqual([
      { institution: "IIM", degree: null, fieldOfStudy: null, startYear: null, endYear: null },
    ]);
  });

  it("keeps Open to in its own order, each once, and a headline on one line", () => {
    expect(membershipProfileUpdateSchema.parse({ openTo: ["INVESTING", "HIRING", "INVESTING"] }).openTo).toEqual(["HIRING", "INVESTING"]);
    expect(membershipProfileUpdateSchema.parse({ headline: "  Builds\n  payments   at Zylo " }).headline).toBe("Builds payments at Zylo");
    expect(membershipProfileUpdateSchema.parse({ headline: "" }).headline).toBeNull();
  });

  it("leaves the new details out of a registration that doesn't send them, so nothing stored is cleared", () => {
    const parsed = membershipProfileSchema.parse({ fullName: "Asha Rao", startYear: 2008, batchYear: 2012, professionType: "EMPLOYED" });
    for (const key of ["headline", "industry", "careerStartYear", "skills", "degree", "fieldOfStudy", "openTo", "experiences", "education", "websiteUrl", "githubUrl"]) {
      expect(parsed, key).not.toHaveProperty(key);
    }
  });
});
