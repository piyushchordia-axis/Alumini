import type { EmptyCreate } from "@illuminize/shared";

/** A link's state the feed reads: `compose` opens it with focus in the composer, which is the form for a post. */
export interface FeedArrival {
  compose?: boolean;
}

const FORMS: Readonly<Record<Exclude<EmptyCreate, "post">, string>> = {
  job: "jobs/new",
  business: "businesses/new",
  event: "events/new",
  group: "groups/new",
  // The form opens on the kind asked for, as the Funding page's own buttons do.
  raising: "funding/new?kind=SEEKING",
  investing: "funding/new?kind=OFFERING",
};

/** Where a create action on My posts opens: the section's form, or for a post the feed, with focus in its composer. */
export function myContentHref(slug: string, what: EmptyCreate): { to: string; state?: FeedArrival } {
  if (what === "post") return { to: `/t/${slug}/app/feed`, state: { compose: true } };
  return { to: `/t/${slug}/app/${FORMS[what]}` };
}
