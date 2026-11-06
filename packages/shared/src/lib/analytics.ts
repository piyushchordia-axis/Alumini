import type { TenantFeatures } from "../constants";
import type { CountRow, TenantAnalyticsDto } from "../types/dto";
import { formatCount } from "./admin";
import { formatWeek, plural, SERIES, weekTitle, type ChartTableData, type LegendItem, type Unit } from "./charts";

/**
 * The admin console's Analytics page as data, so both apps show the same figures, cards, tables and screen-reader text
 * and only draw them their own way.
 */

/** The periods an admin can look at, in weeks (the API takes any from 4 to 104). */
export const ANALYTICS_RANGES = [
  { weeks: 12, label: "Last 12 weeks" },
  { weeks: 26, label: "Last 6 months" },
  { weeks: 52, label: "Last 12 months" },
] as const;

export type AnalyticsWeeks = (typeof ANALYTICS_RANGES)[number]["weeks"];

export const DEFAULT_ANALYTICS_WEEKS: AnalyticsWeeks = 12;

/** The period a link or address asks for (`?weeks=26`): one of the ranges, or the default for anything else. */
export function analyticsWeeks(raw: unknown): AnalyticsWeeks {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return ANALYTICS_RANGES.find((r) => r.weeks === n)?.weeks ?? DEFAULT_ANALYTICS_WEEKS;
}

/** A period in words: "12 weeks", "6 months", "12 months". */
export function rangeSpan(weeks: number): string {
  return weeks === 52 ? "12 months" : weeks === 26 ? "6 months" : `${weeks} weeks`;
}

export const sumOf = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** A whole percentage of `total`, 0 when there's no total. */
export const percent = (n: number, total: number): number => (total ? Math.round((n / total) * 100) : 0);

export type DeltaDirection = "up" | "down" | "flat" | "none";

/**
 * A change on the previous period of the same length. The text carries the direction ("+12%", "-5%", "0%"), so an
 * arrow drawn beside it, and any colour, only repeat it.
 */
export interface DeltaView {
  direction: DeltaDirection;
  text: string;
}

/** "+12% vs the previous 12 weeks (10)", or "None in the previous 12 weeks" with nothing to compare with. */
export function deltaView(now: number, prev: number, weeks: number): DeltaView {
  const span = rangeSpan(weeks);
  if (!prev) return { direction: "none", text: now ? `None in the previous ${span}` : `None in this or the previous ${span}` };
  const pct = Math.round(((now - prev) / prev) * 100);
  return {
    direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat",
    text: `${pct > 0 ? "+" : ""}${pct}% vs the previous ${span} (${formatCount(prev)})`,
  };
}

/** A headline figure at the top of the page, with a hint below it: what it includes, or how it changed. */
export interface KpiTile {
  key: "members" | "newMembers" | "activeMembers" | "posts";
  label: string;
  value: number;
  /** The value as shown: "1,234". */
  valueText: string;
  hint: string;
  /** For a figure compared with the previous period: the hint is its text. */
  delta?: DeltaView;
}

/**
 * The four headline figures. The period compared is the one the figures are for (a week per entry in `d.weeks`), not
 * the one picked, so while a new period loads the old figures keep their own words.
 */
export function kpiTiles(d: Pick<TenantAnalyticsDto, "kpis" | "weeks">): KpiTile[] {
  const k = d.kpis;
  const tile = (key: KpiTile["key"], label: string, value: number, prev: number): KpiTile => {
    const delta = deltaView(value, prev, d.weeks.length);
    return { key, label, value, valueText: formatCount(value), hint: delta.text, delta };
  };
  return [
    { key: "members", label: "Approved members", value: k.members, valueText: formatCount(k.members), hint: `${formatCount(k.newMembers)} joined in this period` },
    tile("newMembers", "New members", k.newMembers, k.newMembersPrev),
    tile("activeMembers", "Active members", k.activeMembers, k.activeMembersPrev),
    tile("posts", "Posts", k.posts, k.postsPrev),
  ];
}

/** How many approved members filled in each part of their profile, in the order the card lists them. */
export function completenessRows(c: TenantAnalyticsDto["coverage"]["completeness"]): CountRow[] {
  return [
    { label: "Photo", count: c.photo },
    { label: "Headline", count: c.headline },
    { label: "City", count: c.city },
    { label: "Company", count: c.company },
    { label: "Industry", count: c.industry },
    { label: "Skills", count: c.skills },
    { label: "Past roles", count: c.pastRoles },
    { label: "Education", count: c.education },
    { label: "Birthday", count: c.birthday },
    { label: "LinkedIn", count: c.linkedin },
    { label: "Any link", count: c.anyLink },
    { label: "Confirmed email", count: c.email },
  ];
}

export interface ChartSeries {
  name: string;
  values: number[];
  color: string;
}

/**
 * The kinds of content the institution has switched on, each a line. Colours go to the lines that are there, in order,
 * so switching the feed off doesn't leave a gap in the palette.
 */
export function contentSeries(d: Pick<TenantAnalyticsDto, "series">, features: Pick<TenantFeatures, "feed" | "jobs" | "events">): ChartSeries[] {
  const lines: Array<{ name: string; values: number[] } | false> = [
    features.feed && { name: "Posts", values: d.series.posts },
    features.feed && { name: "Comments", values: d.series.comments },
    features.jobs && { name: "Jobs", values: d.series.jobs },
    features.events && { name: "Events", values: d.series.events },
  ];
  return lines.filter((s) => s !== false).map((s, i) => ({ ...s, color: SERIES[i]! }));
}

/** A week-by-week table: the week with its year, then each column's value that week. */
export function weekRows(weeks: readonly string[], columns: ReadonlyArray<readonly number[]>): Array<Array<string | number>> {
  return weeks.map((w, i) => [formatWeek(w, true), ...columns.map((c) => c[i] ?? 0)]);
}

const MEMBERS = plural("member", "members");

/** What every chart card has: its heading and the text around it, a table of its values, and what a screen reader says. */
interface ChartFrame {
  /** Stable across ranges, for list keys. */
  id: string;
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  table: ChartTableData;
  empty: boolean;
  emptyText?: string;
  /** The chart's summary, for a screen reader. */
  ariaLabel: string;
  /** A card that takes a whole row where cards sit two to a row. */
  wide?: boolean;
}

export interface ColumnChartSpec extends ChartFrame {
  kind: "column";
  /** Each category's axis label ("2 Nov") and the title of its readout ("Week of 2 Nov 2026"). */
  labels: string[];
  titles: string[];
  values: number[];
  unit: Unit;
}

export interface LineChartSpec extends ChartFrame {
  kind: "line";
  labels: string[];
  titles: string[];
  series: ChartSeries[];
}

export interface HBarChartSpec extends ChartFrame {
  kind: "hbar";
  rows: CountRow[];
  unit: Unit;
  /** The scale's end (100 for percentages); the largest value when not given. */
  max?: number;
  format?: (n: number) => string;
}

export type AnalyticsChart = ColumnChartSpec | LineChartSpec | HBarChartSpec;

export interface AnalyticsSection {
  /** A heading above the section's cards; the first has none. */
  heading?: string;
  charts: AnalyticsChart[];
}

function distribution(id: string, title: string, rows: CountRow[], subtitle?: string): HBarChartSpec {
  return {
    kind: "hbar",
    id,
    title,
    subtitle,
    rows,
    unit: MEMBERS,
    table: { columns: [title, "Members"], rows: rows.map((r) => [r.label, r.count]) },
    empty: rows.length === 0,
    emptyText: "No answers yet.",
    ariaLabel: `${title}: ${rows.map((r) => `${r.label} ${r.count}`).join(", ")}`,
  };
}

/**
 * The page's chart cards, in order: growth and activity first, then who the members are. The activity card is there
 * only while some kind of content is switched on.
 */
export function analyticsView(d: TenantAnalyticsDto, features: Pick<TenantFeatures, "feed" | "jobs" | "events">): AnalyticsSection[] {
  const weekLabels = d.weeks.map((w) => formatWeek(w));
  const weekTitles = d.weeks.map(weekTitle);
  const content = contentSeries(d, features);
  const c = d.coverage.completeness;
  const completeness = completenessRows(c);
  const batches = d.coverage.batches;

  const growth: AnalyticsChart[] = [
    {
      kind: "column",
      id: "new-members",
      title: "New members per week",
      subtitle: "Approvals, by the week they joined",
      labels: weekLabels,
      titles: weekTitles,
      values: d.series.joined,
      unit: "approved",
      table: { columns: ["Week", "Approved", "Signed up"], rows: weekRows(d.weeks, [d.series.joined, d.series.registered]) },
      empty: sumOf(d.series.joined) === 0 && sumOf(d.series.registered) === 0,
      ariaLabel: `New members per week, ${sumOf(d.series.joined)} in total`,
    },
    {
      kind: "line",
      id: "active-members",
      title: "Active members per week",
      subtitle: "Members who used the app at least once that week (the definition billing uses)",
      labels: weekLabels,
      titles: weekTitles,
      series: [{ name: "Active members", values: d.series.active, color: SERIES[0] }],
      table: { columns: ["Week", "Active members"], rows: weekRows(d.weeks, [d.series.active]) },
      empty: sumOf(d.series.active) === 0,
      ariaLabel: "Active members per week",
    },
  ];
  if (content.length > 0) {
    growth.push({
      kind: "line",
      id: "activity",
      title: "Activity per week",
      subtitle: "Published or awaiting review; rejected content isn't counted",
      labels: weekLabels,
      titles: weekTitles,
      series: content,
      legend: content.map((s) => ({ label: s.name, color: s.color, kind: "line" })),
      table: { columns: ["Week", ...content.map((s) => s.name)], rows: weekRows(d.weeks, content.map((s) => s.values)) },
      empty: content.every((s) => sumOf(s.values) === 0),
      ariaLabel: `Activity per week: ${content.map((s) => `${s.name} ${sumOf(s.values)}`).join(", ")}`,
      wide: true,
    });
  }

  const members: AnalyticsChart[] = [
    {
      kind: "column",
      id: "batches",
      title: "Members by batch",
      subtitle: "Approved members by graduating year",
      labels: batches.map((b) => b.label),
      titles: batches.map((b) => `Batch of ${b.label}`),
      values: batches.map((b) => b.count),
      unit: MEMBERS,
      table: { columns: ["Batch", "Members"], rows: batches.map((b) => [b.label, b.count]) },
      empty: batches.length === 0,
      ariaLabel: "Members by batch",
    },
    {
      kind: "hbar",
      id: "completeness",
      title: "Profile completeness",
      subtitle: `Share of ${formatCount(c.total)} approved members who added each detail`,
      rows: completeness.map((r) => ({ label: r.label, count: percent(r.count, c.total) })),
      format: (n) => `${n}%`,
      max: 100,
      unit: "of members",
      table: { columns: ["Detail", "Members", "Share"], rows: completeness.map((r) => [r.label, r.count, `${percent(r.count, c.total)}%`]) },
      empty: c.total === 0,
      ariaLabel: `Profile completeness: ${completeness.map((r) => `${r.label} ${percent(r.count, c.total)}%`).join(", ")}`,
    },
    distribution("cities", "Top cities", d.coverage.cities, "Approved members by city (top 10)"),
    distribution("countries", "Countries", d.coverage.countries),
    distribution("professions", "Professions", d.coverage.professions),
    ...d.coverage.fields.map((f) => distribution(`field:${f.key}`, f.label, f.options, "Answers to your profile question")),
    {
      kind: "hbar",
      id: "invitations",
      title: "Invitations",
      subtitle: "All invitations you've imported",
      rows: [
        { label: "Imported", count: d.invites.total },
        { label: "Sent", count: d.invites.sent },
        { label: "Joined", count: d.invites.accepted },
      ],
      unit: plural("invitation", "invitations"),
      table: {
        columns: ["Stage", "Invitations"],
        rows: [
          ["Imported", d.invites.total],
          ["Sent", d.invites.sent],
          ["Joined", d.invites.accepted],
        ],
      },
      empty: d.invites.total === 0,
      emptyText: "No invitations yet. Import a list from the Invitations page.",
      ariaLabel: `Invitations: ${d.invites.total} imported, ${d.invites.sent} sent, ${d.invites.accepted} joined`,
    },
  ];

  return [{ charts: growth }, { heading: "Who your members are", charts: members }];
}
