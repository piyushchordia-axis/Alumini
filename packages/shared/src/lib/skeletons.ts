import type { MyContentTab } from "./emptyStates";

// The outlines a list draws while its first page loads, the same on both apps: what leads each item, how wide its lines
// are and how many items show. They are neutral slate on white, never the brand colour, and each app draws them from
// these numbers alone (web `ui/Skeleton.tsx`, mobile `components/Skeleton.tsx`).

export const SKELETON_SHAPES = ["member", "post", "listing", "event", "row", "notification", "adminRow", "table"] as const;
export type SkeletonShape = (typeof SKELETON_SHAPES)[number];

/** What leads an item: a round photo, a rounded square (a company's logo), or an event's date block. */
export interface SkeletonLead {
  kind: "circle" | "square" | "date";
  /** On the web, in CSS pixels: the size of the photo or tile it stands for. */
  size: number;
  /** On the phone, in points. */
  phoneSize: number;
}

/**
 * `cards`: each item on its own white card. `rows`: the items are rows in one white card, with hairlines between them.
 * `flush`: rows with hairlines and no card around them, for a list that already sits on white (a chat pane, a card).
 */
export type SkeletonFrame = "cards" | "rows" | "flush";

export interface SkeletonLayout {
  lead: SkeletonLead | null;
  /**
   * The lines beside the lead, each a percentage of the text column's width; the first is the item's title, drawn
   * taller. In a table they are its cells, side by side.
   */
  lines: readonly number[];
  /** Full-width lines under the item's head (a post's text), as percentages. */
  body: readonly number[];
  /** Pills along the item's foot (a post's reactions, comments and share). */
  pills: number;
  /** A short bar at the end of the head: a notification's time, or a console row's action button (wide screens only). */
  trailing: "time" | "action" | null;
  /** The lines are a table's cells under a header bar, rather than stacked beside a lead. */
  table: boolean;
  count: number;
  /** Columns from the web's md breakpoint up, as the list it stands for has. The phone always draws one. */
  columns: 1 | 2;
  frame: SkeletonFrame;
}

const item = (layout: Partial<SkeletonLayout> & Pick<SkeletonLayout, "lines" | "count">): SkeletonLayout => ({
  lead: null,
  body: [],
  pills: 0,
  trailing: null,
  table: false,
  columns: 1,
  frame: "cards",
  ...layout,
});

export const SKELETON_LAYOUTS: Readonly<Record<SkeletonShape, SkeletonLayout>> = {
  /** Directory cards, mentors, members looking for work: a photo, the name, what they do, their years. */
  member: item({ lead: { kind: "circle", size: 56, phoneSize: 48 }, lines: [55, 80, 40], count: 6, columns: 2 }),
  /** Feed posts: the author and when, the text, and the reactions along the foot. */
  post: item({ lead: { kind: "circle", size: 40, phoneSize: 40 }, lines: [35, 20], body: [100, 94, 62], pills: 3, count: 3 }),
  /** Jobs, businesses, funding: a logo, the title and two lines of facts. */
  listing: item({ lead: { kind: "square", size: 44, phoneSize: 44 }, lines: [60, 40, 75], count: 4 }),
  /** Events: the date block, the title, where and when. */
  event: item({ lead: { kind: "date", size: 64, phoneSize: 56 }, lines: [60, 45, 35], count: 4 }),
  /** Conversations, groups, requests, blocked members, attendees, people to invite, institutions to pick. */
  row: item({ lead: { kind: "circle", size: 40, phoneSize: 40 }, lines: [45, 70], count: 6 }),
  /** Notifications: the title with its time, and a line of text. */
  notification: item({ lines: [70, 90], trailing: "time", count: 6, frame: "rows" }),
  /** The consoles' member, report and moderation rows, with an action at the end. */
  adminRow: item({ lead: { kind: "circle", size: 40, phoneSize: 40 }, lines: [45, 65], trailing: "action", count: 6, frame: "rows" }),
  /** The consoles' tables: audit, invitations, institutions. */
  table: item({ lines: [70, 45, 55, 35], table: true, count: 8, frame: "rows" }),
};

/** A line's width in an item, a little shorter on each of three items in turn, so the outline doesn't look stamped out. */
export function skeletonWidth(base: number, row: number): number {
  return Math.min(100, Math.max(20, base - (Math.abs(Math.trunc(row)) % 3) * 8));
}

/** The shape each tab of My posts & listings draws, as its own section's list does. */
export const MY_CONTENT_SKELETONS: Readonly<Record<MyContentTab, SkeletonShape>> = {
  posts: "post",
  jobs: "listing",
  funding: "listing",
  businesses: "listing",
  groups: "row",
  events: "event",
  pastEvents: "event",
};
