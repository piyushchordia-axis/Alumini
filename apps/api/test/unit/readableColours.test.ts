import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";

// The guard is CommonJS, which TypeScript has no types for here, so it is required rather than imported.
const readableColours = createRequire(import.meta.url)("@illuminize/config/eslint/readable-colours.cjs") as Linter.Config;
const RULE = "illuminize-colours/readable-colours";
// Written out rather than read from the rule, so a changed message fails here.
const FAINT_TEXT = "Grey text is slate-500 or darker: slate-400 is for icons, borders and tag edges (CLAUDE.md -> Greys and tones).";
const RAW_BRAND = "Brand text, icons, outlines and checkbox fills use the ink: text-primary-ink (text-page-ink on the page), outline-primary-ink, accent-primary-ink.";
const WHITE_ON_BRAND = "Text on the brand colour uses text-on-primary.";
const FAINT_PLACEHOLDER = "Placeholders use the meta grey (placeholder:text-slate-500).";
const PHONE_FAINT_TEXT = "Grey text uses colors.muted (Muted on the page); colors.faint is for icons, borders and tag edges.";
const PHONE_RAW_BRAND = "Brand text and icons use theme.primaryInk (theme.pageInk on the page).";
const ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");
/** Every app whose source the guard covers: the web app (member app and both consoles) and the phone app. */
const GUARDED = ["apps/web", "apps/mobile"];

/** The guard's messages for `code`, one sample per line, as a file in an app's src. The samples are plain JSX, so ESLint's own parser reads them. */
function guardMessages(lines: string[]) {
  const config: Linter.Config[] = [{ files: ["**/*.tsx"], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }, readableColours];
  const messages = new Linter().verify(lines.join("\n"), config, "src/Sample.tsx");
  const fatal = messages.find((m) => m.fatal);
  if (fatal) throw new Error(`the sample didn't parse: ${fatal.message}`);
  return messages.map((m) => [m.line, m.ruleId === RULE ? m.message : `${m.ruleId}: ${m.message}`]);
}

describe("readable-colours on the web", () => {
  it("rejects grey text in slate-400 in a className, written directly, through clsx or in a template", () => {
    expect(
      guardMessages([
        `export const Time = () => <p className="text-xs text-slate-400">2 hours ago</p>;`,
        `export const When = ({ unread }) => <span className={clsx("ml-auto", unread ? "font-semibold" : "text-slate-400")}>Today</span>;`,
        `export const Count = ({ size }) => <span className={\`\${size} text-slate-400\`}>12 members</span>;`,
        `export const Inside = () => <div aria-hidden={false}><span className="!text-slate-400">Pending</span></div>;`,
      ]),
    ).toEqual([
      [1, FAINT_TEXT],
      [2, FAINT_TEXT],
      [3, FAINT_TEXT],
      [4, FAINT_TEXT],
    ]);
  });

  it("rejects slate-400 text behind a variant that isn't a disabled control's", () => {
    expect(
      guardMessages([
        `export const Tab = () => <a className="text-slate-700 hover:text-slate-400">Jobs</a>;`,
        `export const Wide = () => <p className="text-slate-500 sm:text-slate-400">12 members</p>;`,
        `export const Tabs = () => <a className="aria-selected:text-slate-900 aria-[selected=false]:text-slate-400">Posts</a>;`,
        `export const Row = () => <a className="group-hover:text-slate-400 data-[empty]:text-slate-400">Open</a>;`,
        `export const On = () => <button className="not-disabled:text-slate-400">Send</button>;`,
      ]),
    ).toEqual([1, 2, 3, 4, 5].map((line) => [line, FAINT_TEXT]));
  });

  it("rejects slate-400 text under an aria-hidden that may be false", () => {
    expect(
      guardMessages([
        `export const Drawer = ({ open }) => <div aria-hidden={!open}><p className="text-xs text-slate-400">Last seen</p></div>;`,
        `export const Letters = ({ photo }) => <span aria-hidden={photo ? true : undefined}><b className="text-slate-400">AB</b></span>;`,
      ]),
    ).toEqual([
      [1, FAINT_TEXT],
      [2, FAINT_TEXT],
    ]);
  });

  it("rejects a placeholder in slate-400 or slate-300", () => {
    expect(
      guardMessages([
        `export const Search = () => <input className="rounded border placeholder:text-slate-400" />;`,
        `export const Note = ({ tone }) => <textarea className={\`\${tone} placeholder:text-slate-300\`} />;`,
      ]),
    ).toEqual([
      [1, FAINT_PLACEHOLDER],
      [2, FAINT_PLACEHOLDER],
    ]);
  });

  it("rejects raw brand text, icons, outlines, rings, underlines and checkbox fills in any string, class maps included", () => {
    expect(
      guardMessages([
        `export const More = () => <a className="text-sm text-primary hover:underline">See all</a>;`,
        `export const Ring = () => <button className="focus-visible:outline-2 focus-visible:outline-primary">Save</button>;`,
        `export const Box = () => <input type="checkbox" className="accent-primary" />;`,
        `export const Link = () => <a className="underline decoration-primary/40">Read</a>;`,
        `export const TONES = { brand: "bg-primary/10 text-primary" };`,
        `export const link = (base) => \`\${base} hover:text-primary\`;`,
        `export const Pin = () => <IconPin size={14} className="text-primary" />;`,
        `export const Focus = () => <button className="focus-visible:ring-2 focus-visible:ring-primary">Save</button>;`,
        `export const Star = () => <IconStar className="fill-primary stroke-primary" />;`,
      ]),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((line) => [line, RAW_BRAND]));
  });

  it("rejects the raw brand written as an arbitrary value or an inline colour, quoted or in backticks", () => {
    expect(
      guardMessages([
        `export const A = () => <a className="text-[rgb(var(--c-primary))]">Open</a>;`,
        `export const B = () => <input type="checkbox" className="accent-[var(--color-primary)]" />;`,
        `export const C = () => <a className="hover:text-(--color-primary)">Open</a>;`,
        `export const D = () => <a className="[color:var(--color-primary)]">Open</a>;`,
        `export const E = () => <p style={{ color: "rgb(var(--c-primary))" }}>Pinned</p>;`,
        `export const F = ({ a }) => <p style={{ color: \`rgb(var(--c-primary) / \${a})\` }}>Pinned</p>;`,
        `export const G = () => <p style={{ outlineColor: \`var(--color-primary)\` }}>Pinned</p>;`,
        `export const H = () => <button className="focus-visible:ring-[var(--color-primary)]">Save</button>;`,
      ]),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((line) => [line, RAW_BRAND]));
  });

  it("rejects white text on the raw brand fill, in one string or across a className's", () => {
    expect(
      guardMessages([
        `export const Send = () => <button className="rounded-lg bg-primary px-4 text-white">Send</button>;`,
        `export const Count = () => <span className="bg-[rgb(var(--c-primary))] text-white/90">3</span>;`,
        `export const New = () => <p className={clsx("bg-primary", "text-white")}>New</p>;`,
        `export const Dot = ({ on }) => <span className={clsx("rounded-full bg-primary", on && "text-white")}>3</span>;`,
        `export const Pick = ({ active }) => <button className={clsx("px-3", active ? "bg-primary" : "bg-slate-100", active && "text-white")}>Any</button>;`,
        `export const Badge = ({ on }) => <span className={\`\${on ? "bg-primary" : ""} text-white\`}>2</span>;`,
      ]),
    ).toEqual([1, 2, 3, 4, 5, 6].map((line) => [line, WHITE_ON_BRAND]));
  });

  it("allows slate-400 on icons and hidden decoration, disabled text, the ink, on-primary, brand fills and borders, and class maps' greys", () => {
    expect(
      guardMessages([
        `export const Clock = () => <IconClock size={14} className="text-slate-400" />;`,
        `export const Flag = () => <svg className="h-4 w-4 text-slate-400" aria-label="Flag" />;`,
        `export const Dot = () => <span aria-hidden className="text-slate-400">·</span>;`,
        `export const Dots = () => <div aria-hidden="true"><span className="px-1 text-slate-400">·</span></div>;`,
        `export const Off = () => <button disabled className="text-slate-700 disabled:text-slate-400">Send</button>;`,
        `export const Ink = () => <a className="text-primary-ink decoration-primary-ink focus-visible:outline-primary-ink">Open</a>;`,
        `export const Tick = () => <input type="checkbox" className="accent-primary-ink" />;`,
        `export const OnPage = () => <a className="text-page-ink hover:text-[rgb(var(--c-primary-ink))]">See all</a>;`,
        `export const Filled = () => <button className="bg-primary text-on-primary">Post</button>;`,
        `export const Tag = () => <span className="border border-primary-edge bg-primary/10 text-primary-ink">Admin</span>;`,
        `export const Mark = () => <span className="bg-primary-ink text-white">3</span>;`,
        `export const Field = () => <input className="border-primary ring-primary/20 placeholder:text-slate-500 text-slate-500" />;`,
        // A class map may be an icon's: only a className says what slate-400 colours.
        `export const ICON = "shrink-0 text-slate-400";`,
        `export const Next = () => <a aria-disabled className="text-slate-700 aria-disabled:text-slate-400 group-disabled:text-slate-400">Next</a>;`,
        `export const Menu = () => <button className="text-slate-700 [&>svg]:text-slate-400">Options</button>;`,
        `export const Chosen = () => <button className="bg-primary-wash ring-1 ring-primary-ring focus-visible:ring-primary-ink">Any</button>;`,
        `export const Spark = () => <svg className="fill-primary/20 stroke-primary-ink" />;`,
        // White on its own dark fill, and on-primary on the brand: no white on the brand however the strings combine.
        `export const Mode = ({ dark }) => <button className={clsx("px-3", dark ? "bg-slate-900 text-white" : "bg-primary text-on-primary")}>Go</button>;`,
        `export const Swatch = () => <p style={{ color: "rgb(var(--c-primary-ink))", backgroundColor: \`rgb(var(--c-primary))\` }}>Aa</p>;`,
      ]),
    ).toEqual([]);
  });

  it("allows an icon-only control's slate-400 behind a commented eslint-disable-next-line", () => {
    expect(
      guardMessages([
        `export const Report = () => (`,
        `  <button aria-label="Report message" className={clsx(`,
        `    // Icon only: slate-400 colours the flag, and aria-label names it.`,
        `    // eslint-disable-next-line ${RULE}`,
        `    "flex h-11 w-11 text-slate-400 hover:text-red-600",`,
        `  )}>`,
        `    <IconFlag size={16} />`,
        `  </button>`,
        `);`,
      ]),
    ).toEqual([]);
  });
});

describe("readable-colours on the phone", () => {
  it("rejects faint grey text and placeholders, and raw brand text, icons and spinners", () => {
    expect(
      guardMessages([
        `export const Search = () => <TextInput placeholder="Search" placeholderTextColor={colors.faint} />;`,
        `export const Time = () => <Text style={{ fontSize: 12, color: colors.faint }}>2h</Text>;`,
        `export const Unread = ({ theme }) => <Text style={[styles.time, { color: theme.primary }]}>Now</Text>;`,
        `export const When = ({ theme, unread }) => <Text style={{ color: unread ? theme.primary : colors.muted }}>Today</Text>;`,
        `export const Faded = ({ theme }) => <Animated.Text style={{ color: \`\${theme.primary}cc\` }}>Pinned</Animated.Text>;`,
        `export const Pin = ({ theme }) => <IconPin size={14} color={theme.primary} />;`,
        `export const Busy = ({ theme }) => <ActivityIndicator color={theme.primary} />;`,
        `export const Pull = ({ theme }) => <RefreshControl refreshing tintColor={theme.primary} colors={[theme.primary]} />;`,
      ]),
    ).toEqual([
      [1, PHONE_FAINT_TEXT],
      [2, PHONE_FAINT_TEXT],
      [3, PHONE_RAW_BRAND],
      [4, PHONE_RAW_BRAND],
      [5, PHONE_RAW_BRAND],
      [6, PHONE_RAW_BRAND],
      [7, PHONE_RAW_BRAND],
      [8, PHONE_RAW_BRAND],
      [8, PHONE_RAW_BRAND],
    ]);
  });

  it("allows faint icons and borders, brand fills, borders and tracks, and text in the ink, on-primary and the meta grey", () => {
    expect(
      guardMessages([
        `export const Next = () => <IconChevronRight size={16} color={colors.faint} />;`,
        `export const Box = ({ theme }) => <View style={{ borderColor: colors.faint, backgroundColor: theme.primary }} />;`,
        `export const Ink = ({ theme }) => <Text style={{ color: theme.primaryInk }}>See all</Text>;`,
        `export const On = ({ theme }) => <Text style={{ color: theme.onPrimary }}>Post</Text>;`,
        `export const Page = ({ theme }) => <Text style={[styles.link, { color: theme.pageInk }]}>See all</Text>;`,
        `export const Meta = ({ theme }) => <Text style={{ color: theme.pageMuted }}>2h</Text>;`,
        `export const Search = () => <TextInput placeholderTextColor={colors.muted} />;`,
        `export const Pick = ({ theme }) => <Chip label="Any" color={theme.primary} />;`,
        `export const Toggle = ({ theme }) => <Switch trackColor={{ true: theme.primary }} />;`,
        `export const Busy = ({ theme }) => <ActivityIndicator color={theme.primaryInk} />;`,
        `export const Pull = ({ theme }) => <RefreshControl refreshing tintColor={theme.primaryInk} colors={[theme.primaryInk]} progressBackgroundColor={theme.primary} />;`,
      ]),
    ).toEqual([]);
  });
});

describe("readable-colours in the apps", () => {
  const SAMPLES: Record<string, { code: string; messages: string[] }> = {
    "apps/web": { code: `export const More = () => <a className="text-primary">See all</a>;\n`, messages: [RAW_BRAND] },
    "apps/mobile": { code: `export const Time = () => <Text style={{ color: colors.faint }}>2h</Text>;\n`, messages: [PHONE_FAINT_TEXT] },
  };

  // Turned on in each app's own config: an app whose config left it out would pass lint with faint or raw brand text.
  it.each(GUARDED)("is on in %s's ESLint config", async (dir) => {
    const cwd = resolve(ROOT, dir);
    const eslint = new ESLint({ cwd });
    const [result] = await eslint.lintText(SAMPLES[dir]!.code, { filePath: resolve(cwd, "src/ReadableColoursSample.tsx") });
    expect(result!.messages.filter((m) => m.fatal)).toEqual([]);
    expect(result!.messages.filter((m) => m.ruleId === RULE).map((m) => m.message)).toEqual(SAMPLES[dir]!.messages);
  });

  // CI lints only api, shared and web, so this is what holds the phone app's source to the guard there. Each app's own
  // config and parser; only this rule runs, which keeps it quick.
  it.each(GUARDED)(
    "finds nothing in %s/src",
    async (dir) => {
      const cwd = resolve(ROOT, dir);
      const eslint = new ESLint({ cwd, ruleFilter: ({ ruleId }) => ruleId === RULE });
      const results = await eslint.lintFiles(["src"]);
      expect(results.length).toBeGreaterThan(20);
      const found = results.flatMap((r) => r.messages.filter((m) => m.fatal || m.ruleId === RULE).map((m) => `${relative(cwd, r.filePath)}:${m.line} ${m.message}`));
      expect(found).toEqual([]);
    },
    120_000,
  );
});
