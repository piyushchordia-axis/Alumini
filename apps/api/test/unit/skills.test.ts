import { normalizeSkills, skillKey, skillListSchema, skillMatch, skillMatchText, skillsMatchedFirst } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

describe("normalizeSkills", () => {
  it("trims, collapses inner whitespace and drops blanks, keeping the order", () => {
    expect(normalizeSkills(["  React ", "Machine \t  learning", "", "   ", "Go"])).toEqual(["React", "Machine learning", "Go"]);
  });

  it("drops repeats regardless of case or spacing, keeping the first spelling", () => {
    expect(normalizeSkills(["node.js", "Python", "Node.js", "NODE.JS", "python ", "Machine  Learning", "machine learning"])).toEqual([
      "node.js",
      "Python",
      "Machine Learning",
    ]);
  });

  it("treats full-width letters as the same skill", () => {
    expect(normalizeSkills(["React", "Ｒｅａｃｔ"])).toEqual(["React"]);
  });

  it("returns a new list and leaves the input alone", () => {
    const input = [" a ", "A"];
    expect(normalizeSkills(input)).toEqual(["a"]);
    expect(input).toEqual([" a ", "A"]);
  });
});

describe("skillKey", () => {
  it("compares skills by lower case, NFKC and collapsed spaces", () => {
    expect(skillKey("  Machine   Learning ")).toBe("machine learning");
    expect(skillKey("Ｃ＋＋")).toBe(skillKey("c++"));
    expect(skillKey("Ｃ＋＋")).toBe("c++");
    expect(skillKey("Node.JS")).toBe(skillKey("node.js"));
    expect(skillKey("C#")).not.toBe(skillKey("C++"));
  });
});

describe("skillListSchema", () => {
  const profileSkills = skillListSchema(20, 40);
  const jobSkills = skillListSchema(15, 40);

  it("normalises before it checks, so repeats and blanks don't count towards the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Skill ${i}`);
    expect(profileSkills.parse([...many, " skill 0 ", "", "SKILL 19"])).toEqual(many);
  });

  it("refuses more skills than the limit rather than cutting the list short", () => {
    const result = jobSkills.safeParse(Array.from({ length: 16 }, (_, i) => `Skill ${i}`));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual(["Add at most 15 skills"]);
    expect(jobSkills.parse(Array.from({ length: 15 }, (_, i) => `Skill ${i}`))).toHaveLength(15);
  });

  it("refuses a skill longer than the limit, measured after trimming", () => {
    expect(profileSkills.parse([` ${"x".repeat(40)} `])).toEqual(["x".repeat(40)]);
    const result = profileSkills.safeParse(["React", "x".repeat(41)]);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toMatchObject([{ path: [1], message: "Keep each skill to 40 characters" }]);
  });

  it("points a too-long skill at its place in the list as sent, blanks and repeats included", () => {
    const result = profileSkills.safeParse(["React", "", "react", "x".repeat(41), "Go", `${"y".repeat(20)}   ${"y".repeat(20)}`]);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toMatchObject([{ path: [3], message: "Keep each skill to 40 characters" }, { path: [5] }]);
    // Inner spaces are collapsed before the length is measured.
    expect(profileSkills.parse([`${"y".repeat(19)}   ${"y".repeat(20)}`])).toEqual([`${"y".repeat(19)} ${"y".repeat(20)}`]);
  });

  it("accepts an empty list and refuses what isn't a list of strings", () => {
    expect(profileSkills.parse([])).toEqual([]);
    expect(profileSkills.safeParse("React").success).toBe(false);
    expect(profileSkills.safeParse([1, 2]).success).toBe(false);
  });
});

describe("skillMatch", () => {
  const job = ["Node.js", "TypeScript", "PostgreSQL", "AWS"];

  it("matches regardless of case, spacing or full-width letters, giving the job's skills in its order and spelling", () => {
    expect(skillMatch(job, ["  aws ", "typescript", "Ｎｏｄｅ.js"])).toEqual({ matched: ["Node.js", "TypeScript", "AWS"], count: 3, total: 4 });
    expect(skillMatch(["Machine Learning"], ["machine   learning"])).toEqual({ matched: ["Machine Learning"], count: 1, total: 1 });
  });

  it("doesn't match a skill that only looks alike", () => {
    expect(skillMatch(["C++", "Java"], ["C#", "JavaScript", "c"])).toEqual({ matched: [], count: 0, total: 2 });
  });

  it("counts a skill once, however often either list repeats it", () => {
    expect(skillMatch(["SQL", "sql", "Excel", " SQL "], ["Sql", "SQL", "sql"])).toEqual({ matched: ["SQL"], count: 1, total: 2 });
  });

  it("matches nothing when either list is empty, and leaves blanks out of the total", () => {
    expect(skillMatch(job, [])).toEqual({ matched: [], count: 0, total: 4 });
    expect(skillMatch([], ["TypeScript"])).toEqual({ matched: [], count: 0, total: 0 });
    expect(skillMatch([], [])).toEqual({ matched: [], count: 0, total: 0 });
    expect(skillMatch(["", "  ", "Go"], ["", "go"])).toEqual({ matched: ["Go"], count: 1, total: 1 });
  });

  it("counts only the job's skills when the member lists more", () => {
    const member = ["Go", "Kubernetes", "AWS", "Terraform", "TypeScript", "React", "Docker", "Python"];
    expect(skillMatch(job, member)).toEqual({ matched: ["TypeScript", "AWS"], count: 2, total: 4 });
  });

  it("is said as how many of the job's skills the member has", () => {
    expect(skillMatchText(skillMatch(job, ["aws", "typescript"]))).toBe("You have 2 of 4 skills");
    expect(skillMatchText(skillMatch(job, ["Rust"]))).toBe("You have 0 of 4 skills");
    expect(skillMatchText(skillMatch(["ROS2"], ["ros2"]))).toBe("You have 1 of 1 skill");
  });
});

describe("skillsMatchedFirst", () => {
  const job = ["Node.js", "TypeScript", "PostgreSQL", "AWS"];

  it("puts the skills the member has first, each part in the job's order, so a card's first three show them", () => {
    const { matched } = skillMatch(job, ["aws", "typescript"]);
    expect(skillsMatchedFirst(job, matched)).toEqual([
      { skill: "TypeScript", matched: true },
      { skill: "AWS", matched: true },
      { skill: "Node.js", matched: false },
      { skill: "PostgreSQL", matched: false },
    ]);
  });

  it("keeps the job's order when nothing matches", () => {
    expect(skillsMatchedFirst(job, []).map((s) => s.skill)).toEqual(job);
    expect(skillsMatchedFirst([], ["AWS"])).toEqual([]);
  });
});
