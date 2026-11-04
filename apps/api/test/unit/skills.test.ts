import { normalizeSkills, skillKey, skillListSchema } from "@illuminize/shared";
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
