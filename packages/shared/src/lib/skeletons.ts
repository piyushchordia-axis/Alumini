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

// The outlines a detail or form page draws under its header and Back while its first answer comes, the same on both
// apps (web `PageSkeleton` in ui/Skeleton.tsx; mobile `PageSkeleton` in components/Skeleton.tsx, which `LoadingScreen`
// draws under `Screen title=`). Like the lists', neutral slate on white.

export const PAGE_SKELETON_SHAPES = ["article", "profile", "form", "thread", "panel"] as const;
export type PageSkeletonShape = (typeof PAGE_SKELETON_SHAPES)[number];

/** A page's outline, drawn in this order: its tiles, then one white card (lead and head, sections, fields, actions), or its bubbles. */
export interface PageSkeletonLayout {
  /** What leads the head, above it on a phone and beside it on a wide screen: a profile's photo. */
  lead: SkeletonLead | null;
  /** The head's lines: the title, drawn taller, then the lines under it (when, where, what they do), as percentages. */
  head: readonly number[];
  /** Figures side by side above the card, as a dashboard's: two to a row, four from the web's lg breakpoint up. */
  tiles: number;
  /** Groups of lines under the head, each set off by a hairline, as percentages of the card's width. */
  sections: readonly (readonly number[])[];
  /** A form's fields: a short label over a full-width box each. */
  fields: number;
  /** Buttons along the card's foot. */
  actions: number;
  /** A chat's bubbles, theirs and yours in turn (theirs first), each a percentage of the pane's width, on no card. */
  bubbles: readonly number[];
}

const page = (layout: Partial<PageSkeletonLayout>): PageSkeletonLayout => ({ lead: null, head: [], tiles: 0, sections: [], fields: 0, actions: 0, bubbles: [], ...layout });

export const PAGE_SKELETONS: Readonly<Record<PageSkeletonShape, PageSkeletonLayout>> = {
  /** A post, a job, an event, a listing, a group, a digest: the title and two lines of when and where, the text, then its buttons. */
  article: page({ head: [70, 45, 35], sections: [[100, 96, 90, 55]], actions: 2 }),
  /** A member's or a mentor's page: the photo, the name, what they do and their years, then two groups of details. */
  profile: page({ lead: { kind: "circle", size: 96, phoneSize: 88 }, head: [45, 70, 40], sections: [[30, 90, 75], [30, 85, 60]] }),
  /** An edit form or settings, under the title the page already shows: four fields and the button that saves them. */
  form: page({ fields: 4, actions: 1 }),
  /** A chat's messages, in the pane under its header. */
  thread: page({ bubbles: [55, 40, 70, 35, 60] }),
  /** The consoles' dashboards, analytics and the platform's figures: four tiles over a card of rows. */
  panel: page({ tiles: 4, sections: [[35, 90, 80, 85, 70]] }),
};
