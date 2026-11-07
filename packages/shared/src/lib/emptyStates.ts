import type { FundingKind, TenantFeature, TenantFeatures, TenantType } from "../constants";
import type { TenantSummaryDto } from "../types/dto";
import { CAN_REFER_LABEL } from "./referrals";

// What the member lists say when they're empty, and when each offers a way on, the same on both apps. Each app draws one
// with its EmptyState: the section's icon, or the search icon on a search or a filter's result (`live`).

/** What a member list calls the other members: "fellow members" at a community (OTHER), "batchmates" elsewhere. */
export type PeersWord = "fellow members" | "batchmates";

export function peersWord(type: TenantType): PeersWord {
  return type === "OTHER" ? "fellow members" : "batchmates";
}

/**
 * The member looking at the list, as both apps' useMembership() gives them: the institution with its resolved switches,
 * and whether they may use chat (a current pupil may not).
 */
export interface EmptyViewer {
  tenant: Pick<TenantSummaryDto, "type" | "name" | "shortName"> & { settings: { features: TenantFeatures } };
  membership: { chatEligible: boolean };
}

/**
 * `create` opens the form that adds the first one: a link (on the web feed, a button that focuses the composer above).
 * `showAll` is a button that clears the search and the filters where they are, then puts focus in the search box.
 */
export type EmptyActionKind = "create" | "showAll";

export interface EmptyAction {
  label: string;
  kind: EmptyActionKind;
  /** The main way on is primary. Adding one is outline when the list is a search that found nothing. */
  variant: "primary" | "outline";
}

export interface EmptyCopy {
  title: string;
  description?: string;
  action?: EmptyAction;
  /** A search or a filter's result: screen readers read it out (EmptyState `live`), and it shows the search icon. */
  live: boolean;
}

/** What an empty list can offer to add. */
export type EmptyCreate = "post" | "job" | "business" | "event" | "group" | "raising" | "investing";

/**
 * The words of each create action: the screen's own button for it, so one place keeps one name (the web's header buttons
 * draw a "+" before some).
 */
export const EMPTY_CREATE_LABELS: Readonly<Record<EmptyCreate, string>> = {
  post: "Write a post",
  job: "Post a job",
  business: "Add a business",
  event: "Plan a gathering",
  group: "Create group",
  raising: "I'm raising",
  investing: "I'm investing",
};

const CREATE_RULES: Readonly<Record<EmptyCreate, (features: TenantFeatures, chatEligible: boolean) => boolean>> = {
  post: (f) => f.feed,
  job: (f) => f.jobs,
  business: (f) => f.businesses,
  event: (f) => f.events,
  // A group is a kind of chat, which a current pupil can't use.
  group: (f, chatEligible) => f.groups && chatEligible,
  raising: (f) => f.funding,
  investing: (f) => f.funding,
};

/**
 * Whether an empty list may offer to add `what`: its section is switched on, and a group also needs a member who may chat.
 * Every approved member may post and list, current pupils included, so no role enters into it.
 */
export function mayCreate(what: EmptyCreate, viewer: EmptyViewer): boolean {
  return CREATE_RULES[what](viewer.tenant.settings.features, viewer.membership.chatEligible);
}

function create(what: EmptyCreate, viewer: EmptyViewer, variant: EmptyAction["variant"] = "primary"): EmptyAction | undefined {
  return mayCreate(what, viewer) ? { label: EMPTY_CREATE_LABELS[what], kind: "create", variant } : undefined;
}

const showAll = (label: string): EmptyAction => ({ label, kind: "showAll", variant: "primary" });

const nameOf = (tenant: EmptyViewer["tenant"]) => tenant.shortName ?? tenant.name;

export function feedEmpty(viewer: EmptyViewer): EmptyCopy {
  return {
    title: `No posts yet at ${nameOf(viewer.tenant)}`,
    description: `Be the first to share an update with your ${peersWord(viewer.tenant.type)}.`,
    action: create("post", viewer),
    live: false,
  };
}

/** Openings. `canRefer` is the Can refer filter, which wins; `filtered` is any other filter or a search. */
export function jobsEmpty(viewer: EmptyViewer, { canRefer, filtered }: { canRefer: boolean; filtered: boolean }): EmptyCopy {
  if (canRefer) return { title: "No openings can refer right now", description: "When a poster offers to refer people for a job, it shows here.", action: showAll("Show all openings"), live: true };
  if (filtered) return { title: "No openings match", description: "Try removing a filter.", action: showAll("Show all openings"), live: true };
  return { title: "No openings right now", description: `Know of a role? Post it for your ${peersWord(viewer.tenant.type)}.`, action: create("job", viewer), live: false };
}

export const SEEKERS_EMPTY: EmptyCopy = { title: "Nobody is looking right now", description: "Members who say they're looking for work are listed here.", live: false };

/**
 * Requests about the member's own jobs. `limited` is Referrals shown as a way out, to a member who can't use them now:
 * it offers only what's needed to leave, so no Post a job.
 */
export function referralsReceivedEmpty(viewer: EmptyViewer, limited: boolean): EmptyCopy {
  if (limited) return { title: "No referral requests yet", description: "Requests about the jobs you post show here.", live: false };
  return {
    title: "No referral requests yet",
    description: `When you post a job and tick “${CAN_REFER_LABEL}”, members can ask you for a referral. Their requests wait here for your answer.`,
    action: create("job", viewer),
    live: false,
  };
}

/** `filtered`: a search, a city or a category. */
export function businessesEmpty(viewer: EmptyViewer, filtered: boolean): EmptyCopy {
  if (filtered) return { title: "No businesses match", description: "Try another name, category or city.", action: showAll("Show all businesses"), live: true };
  return { title: "No businesses listed yet", description: `Run a business? Add it for your ${peersWord(viewer.tenant.type)}.`, action: create("business", viewer), live: false };
}

export function eventsEmpty(viewer: EmptyViewer, scope: "upcoming" | "past"): EmptyCopy {
  if (scope === "past") return { title: "No past events", description: "Gatherings show here once they're over.", live: false };
  return { title: "Nothing planned yet", description: "Heading somewhere? Plan a gathering and see who wants to join.", action: create("event", viewer), live: false };
}

/** The create form opens on the same kind (`?kind=`), as the screen's own buttons do. */
export function fundingEmpty(viewer: EmptyViewer, kind: FundingKind): EmptyCopy {
  if (kind === "SEEKING") return { title: "No one is raising right now", description: "Members raising money for a venture are listed here.", action: create("raising", viewer), live: false };
  return { title: "No investors listed yet", description: "Members who invest in ventures are listed here.", action: create("investing", viewer), live: false };
}

/** `filtered`: a search or any filter, including Were there in. */
export function directoryEmpty(filtered: boolean): EmptyCopy {
  if (filtered) return { title: "No members match", description: "Try removing a filter.", action: showAll("Show all members"), live: true };
  return { title: "No members yet", description: "Members show here once they've joined.", live: false };
}

/** Discover (open groups, `searching` by name) or the member's own groups. */
export function groupsEmpty(viewer: EmptyViewer, list: "discover" | "mine", searching: boolean): EmptyCopy {
  if (list === "mine") return { title: "You're not in any groups yet", description: "Find one to join in Discover, or create your own.", action: create("group", viewer), live: false };
  if (searching) return { title: "No groups match", description: "Try another name, or create the group yourself.", action: create("group", viewer, "outline"), live: true };
  return { title: "No open groups yet", description: "Create one, and any member here can find and join it.", action: create("group", viewer), live: false };
}

/** Its Settings link sits just above, so it offers nothing. */
export function notificationsEmpty(viewer: EmptyViewer): EmptyCopy {
  return { title: "You're all caught up", description: `Replies, requests and news from ${nameOf(viewer.tenant)} show up here.`, live: false };
}

/** The institution picker, before anyone signs in. Clear search empties the box and puts focus back in it. */
export function tenantSearchEmpty(searching: boolean): EmptyCopy {
  if (!searching) return { title: "No institutions found", description: "Ask your alumni office to join Illuminize.", live: false };
  return {
    title: "No institutions found",
    description: "Try a different search, or ask your alumni office to join Illuminize.",
    action: { label: "Clear search", kind: "showAll", variant: "outline" },
    live: true,
  };
}

/* ---------- My posts & listings ---------- */

/** The tabs of My posts & listings, in the order both apps show them. */
export const MY_CONTENT_TABS = ["posts", "jobs", "funding", "businesses", "groups", "events", "pastEvents"] as const;
export type MyContentTab = (typeof MY_CONTENT_TABS)[number];

/** The section icon a tab's empty state draws: names both apps' NavIcon knows. */
export type MyContentIcon = "posts" | "jobs" | "funding" | "businesses" | "groups" | "events";

interface MyContentTabCopy {
  label: string;
  icon: MyContentIcon;
  /** The switch the tab's section follows. */
  feature: TenantFeature;
  emptyTitle: string;
  emptyText: (peers: PeersWord) => string;
  /** What its empty state offers to add, the first as the primary way on. */
  create: readonly EmptyCreate[];
}

export const MY_CONTENT: Readonly<Record<MyContentTab, MyContentTabCopy>> = {
  posts: {
    label: "Posts",
    icon: "posts",
    feature: "feed",
    emptyTitle: "You haven't posted yet",
    emptyText: (peers) => `Share news or ask your ${peers} a question. Posts waiting for approval show here too.`,
    create: ["post"],
  },
  jobs: {
    label: "Jobs",
    icon: "jobs",
    feature: "jobs",
    emptyTitle: "You haven't posted a job yet",
    emptyText: (peers) => `Hiring, or know of a role? Post it for your ${peers}.`,
    create: ["job"],
  },
  funding: {
    label: "Funding",
    icon: "funding",
    feature: "funding",
    emptyTitle: "You haven't listed any funding yet",
    emptyText: () => "Raising money or looking to invest? List it so members can find you.",
    create: ["raising", "investing"],
  },
  businesses: {
    label: "Businesses",
    icon: "businesses",
    feature: "businesses",
    emptyTitle: "You haven't listed a business yet",
    emptyText: (peers) => `Run a business? Add it so your ${peers} can find it.`,
    create: ["business"],
  },
  groups: {
    label: "Groups",
    icon: "groups",
    feature: "groups",
    emptyTitle: "You haven't created a group yet",
    emptyText: () => "Start one for your city, your year or an interest. Groups you create show here.",
    create: ["group"],
  },
  events: {
    // Beside Past events, so it says which.
    label: "Upcoming events",
    icon: "events",
    feature: "events",
    emptyTitle: "You aren't organising anything yet",
    emptyText: () => "Heading somewhere? Plan a gathering and see who wants to join.",
    create: ["event"],
  },
  pastEvents: {
    label: "Past events",
    icon: "events",
    feature: "events",
    emptyTitle: "No past events",
    emptyText: () => "Gatherings you organised show here once they're over.",
    create: [],
  },
};

/**
 * The tabs this member sees: each while its section is on, and Groups only for a member who may chat (a group is a kind
 * of chat, which a current pupil can't use), so they never see a tab they couldn't add to.
 */
export function myContentTabs(viewer: EmptyViewer): { value: MyContentTab; label: string }[] {
  const features = viewer.tenant.settings.features;
  return MY_CONTENT_TABS.filter((tab) => features[MY_CONTENT[tab].feature] && (tab !== "groups" || viewer.membership.chatEligible)).map((value) => ({ value, label: MY_CONTENT[value].label }));
}

/** A create action that says what it adds, for a box that may offer more than one (Funding: raising and investing). */
export interface EmptyCreateAction extends EmptyAction {
  kind: "create";
  what: EmptyCreate;
}

export interface MyContentEmpty {
  icon: MyContentIcon;
  title: string;
  description: string;
  /** Each only while mayCreate allows it; the first is primary, the rest outline. */
  actions: EmptyCreateAction[];
}

export function myContentEmpty(tab: MyContentTab, viewer: EmptyViewer): MyContentEmpty {
  const copy = MY_CONTENT[tab];
  return {
    icon: copy.icon,
    title: copy.emptyTitle,
    description: copy.emptyText(peersWord(viewer.tenant.type)),
    actions: copy.create
      .filter((what) => mayCreate(what, viewer))
      .map((what, i): EmptyCreateAction => ({ what, label: EMPTY_CREATE_LABELS[what], kind: "create", variant: i === 0 ? "primary" : "outline" })),
  };
}

/** My posts with every one of its sections switched off. */
export const MY_CONTENT_OFF: Readonly<{ icon: MyContentIcon; title: string; description: string }> = {
  icon: "posts",
  title: "Nothing to show",
  description: "Your institution has switched off posts, jobs, funding, businesses, groups and events.",
};
