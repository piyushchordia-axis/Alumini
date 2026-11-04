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
