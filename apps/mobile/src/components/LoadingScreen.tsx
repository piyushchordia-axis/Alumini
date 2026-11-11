import type { PageSkeletonShape } from "@illuminize/shared";
import type { Href } from "expo-router";
import type { ReactElement } from "react";
import { PageLoad } from "@/components/PageLoad";
import { PageSkeleton } from "@/components/Skeleton";
import { Screen } from "@/components/ui";
import type { PageState } from "@/hooks/usePageQuery";

/**
 * A pushed screen whose first answer hasn't come: the bar it will have (`Screen title=`, with Back, and `badge` and
 * `fallbackHref` as the loaded screen passes them) from the first frame, a cold link's included, and under it the
 * screen's outline (`shape`). Given `page` (usePageQuery), what went wrong shows there too, with Retry loading, rather
 * than in place of the whole screen; a screen that says why on a screen of its own (a job, say) leaves `page` out.
 *
 * Called as a function, `return loadingScreen({ … })`, never drawn as a component of its own: the screen's root is then
 * the same `Screen` before and after its answer, so React keeps the bar, and Back keeps focus, when the content takes the
 * outline's place. A screen whose loaded shell is another (`StackScreen`) draws that shell around `PageLoad` itself.
 */
export function loadingScreen({ title, shape, label, page, badge, fallbackHref }: { title: string; shape: PageSkeletonShape; label?: string; page?: PageState; badge?: string; fallbackHref?: Href }): ReactElement {
  return (
    <Screen title={title} badge={badge} fallbackHref={fallbackHref}>
      {page ? <PageLoad page={page} shape={shape} label={label} /> : <PageSkeleton shape={shape} label={label} />}
    </Screen>
  );
}
