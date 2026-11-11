import type { PageSkeletonShape } from "@illuminize/shared";
import type { ReactNode } from "react";
import { ListError } from "@/components/common/ListBody";
import { PageSkeleton } from "@/components/ui";
import type { PageState } from "@/hooks/usePageQuery";

/** The page's outline (`shape`, with `label` where the page says something more specific), or, for a page that is a list, that list's (`outline`). */
type Outline = { shape: PageSkeletonShape; label?: string } | { outline: ReactNode };

/**
 * What a detail or form page draws under its header and Back while it has nothing to show (usePageQuery): its outline
 * while the first answer comes, or what went wrong with Retry loading. The header and Back stay above it either way, so
 * the page is never swapped for a bare spinner or error.
 */
export function PageLoad({ page, ...outline }: { page: PageState } & Outline) {
  if (page.view === "error") return <ListError error={page.error ?? "Not found"} onRetry={page.retry} retrying={page.retrying} />;
  if (page.view !== "loading") return null;
  return "outline" in outline ? <>{outline.outline}</> : <PageSkeleton shape={outline.shape} label={outline.label} />;
}
