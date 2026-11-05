import { errorMessage, isApiClientError, isTransientError } from "@illuminize/shared/client";
import { IconMentors } from "@/components/icons";
import { Button, EmptyState, LinkButton } from "@/components/ui";
import { mentorsPath } from "@/lib/mentors";

/** Why a mentor can't be shown, in plain words. One who stopped mentoring, one the viewer blocked and a wrong link read the same, as the API answers them. */
export function mentorUnavailableText(error?: unknown): { heading: string; body: string } {
  const answered = isApiClientError(error) && !isTransientError(error);
  const off = isApiClientError(error) && error.code === "FEATURE_DISABLED";
  return {
    heading: off ? "Mentors aren't available" : answered || !error ? "This mentor isn't available" : "This mentor couldn't be opened",
    body: off ? errorMessage(error) : answered || !error ? "They may have stopped mentoring, or the link may be wrong." : "Check your connection, then try again.",
  };
}

/** A mentor who can't be shown says why in plain words and offers a way back, and never blanks the app. */
export function MentorUnavailable({ slug, error, title, text, onRetry }: { slug: string; error?: unknown; title?: string; text?: string; onRetry?: () => void }) {
  const answered = isApiClientError(error) && !isTransientError(error);
  const said = mentorUnavailableText(error);
  const heading = title ?? said.heading;
  const body = text ?? said.body;
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        icon={<IconMentors size={32} className="text-slate-400" />}
        title={heading}
        description={body}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {error !== undefined && !answered && onRetry && (
              <Button variant="outline" className="min-h-11" onClick={onRetry}>
                Retry loading
              </Button>
            )}
            <LinkButton to={mentorsPath(slug)} className="min-h-11">
              Back to mentors
            </LinkButton>
          </div>
        }
      />
    </div>
  );
}
