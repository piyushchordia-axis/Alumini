import { errorMessage, isApiClientError, isTransientError } from "@illuminize/shared/client";
import { IconJobs } from "@/components/icons";
import { Button, EmptyState, LinkButton } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { jobsPath } from "@/lib/referrals";

/** Why a job can't be shown, in plain words. A job removed, hidden or deleted and a wrong link read the same, as the API answers them. */
export function jobUnavailableText(error?: unknown): { heading: string; body: string } {
  const answered = isApiClientError(error) && !isTransientError(error);
  const off = isApiClientError(error) && error.code === "FEATURE_DISABLED";
  return {
    heading: off ? "Jobs aren't available" : answered || !error ? "This job isn't available" : "This job couldn't be opened",
    body: off ? errorMessage(error) : answered || !error ? "It may have been closed or removed, or the link may be wrong." : "Check your connection, then try again.",
  };
}

/** A job that can't be shown, or a referral that can't be asked for, says why in plain words and offers a way back, and never blanks the app. */
export function JobUnavailable({ error, title, text, onRetry }: { error?: unknown; title?: string; text?: string; onRetry?: () => void }) {
  const { tenant } = useMembership();
  const answered = isApiClientError(error) && !isTransientError(error);
  const said = jobUnavailableText(error);
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        icon={<IconJobs size={32} className="text-slate-400" />}
        title={title ?? said.heading}
        description={text ?? said.body}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {error !== undefined && !answered && onRetry && (
              <Button variant="outline" className="min-h-11" onClick={onRetry}>
                Retry loading
              </Button>
            )}
            <LinkButton to={jobsPath(tenant.slug)} className="min-h-11">
              Back to jobs
            </LinkButton>
          </div>
        }
      />
    </div>
  );
}

/** What a referral screen says to a member who can't use referrals now and has nothing there to leave. */
export function ReferralsUnavailable() {
  const { tenant } = useMembership();
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        icon="🔒"
        title="Referrals aren't available"
        description={`Referral requests aren't open to your account at ${tenant.shortName ?? tenant.name}.`}
        action={
          <LinkButton to={jobsPath(tenant.slug)} className="min-h-11">
            Back to jobs
          </LinkButton>
        }
      />
    </div>
  );
}
