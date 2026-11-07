import type { EmptyCreate } from "@illuminize/shared";
import type { Href, ImperativeRouter } from "expo-router";

/**
 * Opens what a create action on My posts adds. Each form but a group's sits on its section's tab stack, so `withAnchor`
 * puts the section's list under it and Back lands there, as Edit profile from the feed does; without it, that stack would
 * hold the form alone. A group's form is above the tabs, so it's a plain push, as the Groups screen's own.
 */
export function myContentPush(router: ImperativeRouter, slug: string, what: EmptyCreate): void {
  // Every create action has its form (`satisfies` fails the build when one is added without), each a route there is.
  const forms = {
    post: `/t/${slug}/feed/new`,
    job: `/t/${slug}/jobs/new`,
    business: `/t/${slug}/businesses/new`,
    event: `/t/${slug}/events/new`,
    // The form opens on the kind asked for, as the Funding screen's own buttons do.
    raising: `/t/${slug}/funding/new?kind=SEEKING`,
    investing: `/t/${slug}/funding/new?kind=OFFERING`,
    group: `/t/${slug}/groups/new`,
  } as const satisfies Record<EmptyCreate, Href>;
  if (what === "group") router.push(forms.group);
  else router.push(forms[what], { withAnchor: true });
}
