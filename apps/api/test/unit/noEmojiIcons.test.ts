import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";

// The guard is CommonJS, which TypeScript has no types for here, so it is required rather than imported.
const noEmojiIcons = createRequire(import.meta.url)("@illuminize/config/eslint/no-emoji-icons.cjs") as Linter.Config;
const MESSAGE = "Draw icons with the SVG set in components/icons.tsx, not emoji (CLAUDE.md -> Icons). Content such as member text belongs in data, not source.";
const ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");
/** Every package whose source the guard covers. */
const GUARDED = ["apps/web", "apps/mobile", "packages/shared"];

/** Built from code points, so no editor or tool can quietly turn them into something else. */
const [LOCK, MEGAPHONE, PARTY, RUNNER, DOWN_ARROW, SMALL_SQUARE] = [0x1f512, 0x1f4e3, 0x1f389, 0x1f3c3, 0x2b07, 0x25aa].map((c) => String.fromCodePoint(c));
/** The escape a lock is written as in source (a backslash, "u" and the code point), not the emoji itself. */
const ESCAPED_LOCK = "\\u{1F512}";

/** The guard's messages for `code`, as a file in an app's src. The samples are plain JSX, so ESLint's own parser reads them. */
function guardMessages(code: string, filename = "src/Sample.tsx") {
  const config: Linter.Config[] = [{ files: ["**/*.tsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }, noEmojiIcons];
  const messages = new Linter().verify(code, config, filename);
  const fatal = messages.find((m) => m.fatal);
  if (fatal) throw new Error(`the sample didn't parse: ${fatal.message}`);
  return messages.map((m) => ({ rule: m.ruleId, line: m.line, message: m.message }));
}

describe("no-emoji-icons", () => {
  it('rejects an emoji passed as an icon, as in icon="\u{1F512}"', () => {
    expect(guardMessages(`export const Locked = () => <EmptyState icon="${LOCK}" title="Messages aren't available" />;`)).toEqual([
      { rule: "no-restricted-syntax", line: 1, message: MESSAGE },
    ]);
  });

  it("rejects an emoji in JSX text, a string and a template", () => {
    const code = [
      `export const Badge = () => <span>${MEGAPHONE} Announcement</span>;`,
      `export const label = "${DOWN_ARROW} Download CSV";`,
      `export const wishes = (n) => \`${PARTY} \${n} wishes\`;`,
    ].join("\n");
    expect(guardMessages(code).map((m) => [m.rule, m.line])).toEqual([
      ["no-restricted-syntax", 1],
      ["no-restricted-syntax", 2],
      ["no-restricted-syntax", 3],
    ]);
  });

  it("rejects an emoji written as an escape, in a string and in a template", () => {
    const code = [`export const label = "${ESCAPED_LOCK} Locked";`, `export const pinned = (n) => \`${ESCAPED_LOCK} \${n} pinned\`;`].join("\n");
    expect(guardMessages(code).map((m) => [m.rule, m.line])).toEqual([
      ["no-restricted-syntax", 1],
      ["no-restricted-syntax", 2],
    ]);
  });

  it("allows SVG icons, typographic glyphs, comments, regex literals and flags built at runtime", () => {
    const code = [
      `export const Locked = () => <EmptyState icon={<IconLock size={32} />} title="Messages aren't available" />;`,
      `export const Close = () => <button aria-label="Close">✕</button>;`,
      `export const marks = ["✓", "‹", "←", "→", "➤", "›", "⋯"];`,
      `// "${RUNNER} Morning runners" is "MR"`,
      `export const BULLET = /^[-*•${SMALL_SQUARE}◦–]\\s+/;`,
      `export const flag = (cc) => String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));`,
    ].join("\n");
    expect(guardMessages(code)).toEqual([]);
  });

  // Turned on in each app's own config: an app whose config left it out, or set no-restricted-syntax again after it
  // (which replaces the selectors), would pass lint with an emoji in it.
  it.each(GUARDED)("is on in %s's ESLint config", async (dir) => {
    const cwd = resolve(ROOT, dir);
    const eslint = new ESLint({ cwd });
    const [result] = await eslint.lintText(`export const Locked = () => <EmptyState icon="${LOCK}" title="Locked" />;\n`, { filePath: resolve(cwd, "src/EmojiGuardSample.tsx") });
    expect(result!.messages.filter((m) => m.fatal)).toEqual([]);
    expect(result!.messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message)).toEqual([MESSAGE]);
  });

  // CI lints only api, shared and web, so this is what holds the phone app's source to the guard there (and the other
  // two as well). Each app's own config and parser; only no-restricted-syntax runs, which keeps it quick.
  it.each(GUARDED)(
    "finds no emoji in %s/src",
    async (dir) => {
      const cwd = resolve(ROOT, dir);
      const eslint = new ESLint({ cwd, ruleFilter: ({ ruleId }) => ruleId === "no-restricted-syntax" });
      const results = await eslint.lintFiles(["src"]);
      expect(results.length).toBeGreaterThan(20);
      const found = results.flatMap((r) => r.messages.filter((m) => m.fatal || m.message === MESSAGE).map((m) => `${relative(cwd, r.filePath)}:${m.line} ${m.message}`));
      expect(found).toEqual([]);
    },
    120_000,
  );
});
