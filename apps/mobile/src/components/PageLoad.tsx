import type { PageSkeletonShape } from "@illuminize/shared";
import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { PageSkeleton } from "@/components/Skeleton";
import { ErrorText, RetryButton } from "@/components/ui";
import type { PageState } from "@/hooks/usePageQuery";
import { spacing } from "@/theme";

/** The screen's outline (`shape`, with `label` where the screen says something more specific), or, for a part that is a list, that list's (`outline`). */
type Outline = { shape: PageSkeletonShape; label?: string } | { outline: ReactNode };

/**
 * What a detail or form screen draws under its bar and Back while it has nothing to show (usePageQuery): its outline
 * while the first answer comes, or what went wrong with Retry loading, as the web's PageLoad. The bar stays above it
 * either way, so the screen is never swapped for a bare spinner or a full-screen error. `style` places the outline or
 * the error where the screen's content would be; `compact` gives Retry loading the console's denser size, in a row.
 */
export function PageLoad({ page, style, compact = false, ...outline }: { page: PageState; style?: StyleProp<ViewStyle>; compact?: boolean } & Outline) {
  if (page.view === "error")
    return (
      <View style={[{ gap: spacing.sm }, style]}>
        <ErrorText error={page.error ?? "Not found"} />
        <RetryButton title="Retry loading" onRetry={page.retry} retrying={page.retrying} size={compact ? "compact" : undefined} />
      </View>
    );
  if (page.view !== "loading") return null;
  return "outline" in outline ? <>{outline.outline}</> : <PageSkeleton shape={outline.shape} label={outline.label} style={style} />;
}
