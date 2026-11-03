import { errorMessage, isApiClientError, isTransientError } from "@illuminize/shared/client";
import { Button, EmptyState, LinkButton } from "@/components/ui";
import { groupsPath } from "@/lib/groups";

/**
 * A group that can't be shown says why in plain words and offers a way back, and never blanks the app. A group that doesn't
 * exist and one this member may not know about read the same, as the API answers them.
 */
export function GroupUnavailable({ slug, error, title, text, onRetry }: { slug: string; error?: unknown; title?: string; text?: string; onRetry?: () => void }) {
  const answered = isApiClientError(error) && !isTransientError(error);
  const off = isApiClientError(error) && error.code === "FEATURE_DISABLED";
  const heading = title ?? (off ? "Groups aren't available" : answered || !error ? "This group isn't available" : "This group couldn't be opened");
  const body = text ?? (off ? errorMessage(error) : answered || !error ? "It may have been archived or removed, or the link may be wrong." : "Check your connection, then try again.");
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        icon="👥"
        title={heading}
        description={body}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {error !== undefined && !answered && onRetry && (
              <Button variant="outline" className="min-h-11" onClick={onRetry}>
                Retry loading
              </Button>
            )}
            <LinkButton to={groupsPath(slug)} className="min-h-11">
              Back to groups
            </LinkButton>
          </div>
        }
      />
    </div>
  );
}
