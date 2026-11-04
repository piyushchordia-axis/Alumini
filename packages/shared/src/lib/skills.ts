/** One skill as it's stored: trimmed, with each run of inner whitespace made one space. */
export const tidySkill = (s: string) => s.trim().replace(/\s+/g, " ");

/**
 * What two skills are compared by: "node.js", "Node.js" and "Ｎｏｄｅ.js" (full-width, as some phone keyboards type it) are
 * one skill. Used to de-duplicate a list and to match a job's skills with a member's.
 */
export function skillKey(skill: string): string {
  return tidySkill(skill.normalize("NFKC")).toLowerCase();
}

/**
 * A list of skills as it's stored: each tidied (`tidySkill`), blanks dropped, and repeats (by `skillKey`) dropped, keeping
 * the first spelling and the order given.
 */
export function normalizeSkills(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const skill = tidySkill(raw);
    if (!skill) continue;
    const key = skillKey(skill);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

/** How a job's skills compare with a member's own (see skillMatch). */
export interface SkillMatch {
  /** The job's skills the member has, in the job's order and spelling. */
  matched: string[];
  /** How many of them there are, out of the job's `total` skills (each counted once, as skillKey compares them). */
  count: number;
  total: number;
}

/**
 * Which of a job's skills a member has, compared by skillKey, so "typescript" on a profile matches "TypeScript" on a job.
 * Only the job's skills count, however many more the member lists.
 */
export function skillMatch(jobSkills: readonly string[], memberSkills: readonly string[]): SkillMatch {
  const have = new Set(memberSkills.map(skillKey));
  const seen = new Set<string>();
  const matched: string[] = [];
  for (const skill of jobSkills) {
    const key = skillKey(skill);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (have.has(key)) matched.push(skill);
  }
  return { matched, count: matched.length, total: seen.size };
}

/**
 * A job's skills with the ones in `matched` (from skillMatch) first, each part keeping the job's order: a card shows the
 * first few, so a member sees the skills they have before the rest are counted as "+N more".
 */
export function skillsMatchedFirst(jobSkills: readonly string[], matched: readonly string[]): Array<{ skill: string; matched: boolean }> {
  const keys = new Set(matched.map(skillKey));
  const marked = jobSkills.map((skill) => ({ skill, matched: keys.has(skillKey(skill)) }));
  return [...marked.filter((s) => s.matched), ...marked.filter((s) => !s.matched)];
}
