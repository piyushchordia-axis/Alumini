import { REFERRAL_NOT_TAKING, REFERRAL_NOTE_MAX_LENGTH, REFERRAL_NOTE_PLACEHOLDER, memberRoleLine, memberYearsLabel, myReferralText, referralAskRefusalText, referralNoteHelp, referralNoteSchema, takesReferralRequests } from "@illuminize/shared";
import { fatalQueryError, isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { JobUnavailable, ReferralsUnavailable, jobUnavailableText } from "@/components/jobs/JobUnavailable";
import { Avatar, Button, Card, ErrorBox, LinkButton, Loading, PageHeader, Textarea } from "@/components/ui";
import { useJob } from "@/hooks/useJob";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { jobPath, jobsPath, refreshReferrals, useReferralsAvailable } from "@/lib/referrals";
import { toast } from "@/stores/uiStore";

/** Remounts per job, so a note written about one is never sent about another. */
export function ReferralRequestRoute() {
  const { jobId = "" } = useParams();
  return <ReferralRequestPage key={jobId} jobId={jobId} />;
}

/**
 * Ask for a referral: a note, said up front to be what the poster reads and, if they accept, the chat's first message. A
 * refetch of the job failing in the background keeps the form and the note, and so does one that shows the job no longer
 * takes requests once something is written: it says so above the note, which stays there to copy, and nothing can be sent.
 */
function ReferralRequestPage({ jobId }: { jobId: string }) {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const available = useReferralsAvailable();
  const query = useJob(slug, jobId, available);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  const fieldId = useId();

  if (!available) return <ReferralsUnavailable />;
  const error = fatalQueryError(query);
  if (error && !query.data) return <JobUnavailable error={error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const j = query.data;
  const poster = j.author.fullName;
  if (j.isMine) return <JobUnavailable title="You can't ask yourself" text="This is your own job. Members ask you for referrals on its page." />;
  // Asked already, perhaps in another tab: one request at a time about a job, and a decline is final.
  const standing = j.myReferral && j.myReferral.status !== "WITHDRAWN" && j.myReferral.status !== "CLOSED" ? j.myReferral : null;
  // Then what of the member's own stands in the way: asked as many times as they can, or a block they made.
  const refused = error ? jobUnavailableText(error) : !takesReferralRequests(j, now) ? REFERRAL_NOT_TAKING : j.referralAskRefusal ? referralAskRefusalText(j.referralAskRefusal, poster) : null;
  // With nothing written yet there's nothing to keep, so a job that takes no requests just says so.
  if (refused && !standing && note === "") return <JobUnavailable title={refused.heading} text={refused.body} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (refused) return;
    setServerError(null);
    const parsed = referralNoteSchema.safeParse(note);
    if (!parsed.success) {
      setNoteError(parsed.error.issues[0]?.message);
      return;
    }
    setNoteError(undefined);
    setBusy(true);
    try {
      await api.jobs.referrals.request(slug, j.id, { note: parsed.data });
      toast.success("Request sent");
      // In place of this form, so going back from Referrals lands on the job rather than on a form that would ask again.
      navigate(jobsPath(slug, "referrals", "sent"), { replace: true });
      void refreshReferrals(qc, slug);
    } catch (err) {
      const fieldError = isApiClientError(err) ? err.fieldErrors.note : undefined;
      if (fieldError) setNoteError(fieldError);
      else setServerError(err);
      setBusy(false);
      // The job may have closed, or the poster answered an earlier request: the page says so once it's read again.
      void query.refetch();
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={jobPath(slug, j.id)} className="inline-flex min-h-11 items-center text-sm text-slate-500 hover:text-slate-800 [overflow-wrap:anywhere]">
        ← {j.title}
      </Link>
      <PageHeader title="Ask for a referral" />
      <Card className="p-5">
        <p className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{j.title}</p>
        <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">
          {j.companyName}
          {j.location ? ` · ${j.location}` : ""}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Avatar name={poster} src={j.author.avatarUrl} size="md" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 [overflow-wrap:anywhere]">Posted by {poster}</p>
            <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">{memberRoleLine(j.author)}</p>
            <p className="text-xs text-slate-500">{memberYearsLabel(j.author)}</p>
          </div>
        </div>
        <div className="mt-5 border-t border-slate-100 pt-5">
          {standing ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">{myReferralText(standing.status, poster)}</p>
              <LinkButton to={jobsPath(slug, "referrals", "sent")} variant="outline" className="min-h-11">
                See your requests
              </LinkButton>
            </div>
          ) : (
            <form className="space-y-4" noValidate onSubmit={(e) => void submit(e)}>
              {refused && (
                <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">{refused.heading}</p>
                  <p className="mt-0.5">{refused.body} Your note is still below, so you can copy it.</p>
                </div>
              )}
              {/* Laid out here rather than in FormField, so the help and the count stay in view beside an error, and the box's name is its label alone. */}
              <div>
                {/* The asterisk is for the eye: the box says it's required itself, so its name is the label alone, as on the mobile app. */}
                <label htmlFor={`${fieldId}-note`} className="mb-1 block text-sm font-medium text-slate-700">
                  Note to the poster
                  <span className="text-red-500" aria-hidden="true">
                    {" "}
                    *
                  </span>
                </label>
                {/* Off, so the browser doesn't keep what's written here for session restore, where it would outlast sign-out. */}
                <Textarea
                  id={`${fieldId}-note`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={6}
                  maxLength={REFERRAL_NOTE_MAX_LENGTH}
                  invalid={!!noteError}
                  aria-invalid={!!noteError}
                  aria-required="true"
                  aria-describedby={`${noteError ? `${fieldId}-error ` : ""}${fieldId}-help ${fieldId}-count`}
                  autoComplete="off"
                  placeholder={REFERRAL_NOTE_PLACEHOLDER}
                />
                {noteError && (
                  <p id={`${fieldId}-error`} className="mt-1 text-xs text-red-600" role="alert">
                    {noteError}
                  </p>
                )}
                <p className="mt-1 flex justify-between gap-2 text-xs text-slate-500">
                  <span id={`${fieldId}-help`}>{referralNoteHelp(poster)}</span>
                  <span id={`${fieldId}-count`} className="shrink-0 tabular-nums">
                    {note.length} / {REFERRAL_NOTE_MAX_LENGTH}
                  </span>
                </p>
              </div>
              {serverError ? <ErrorBox error={serverError} /> : null}
              <Button type="submit" className="min-h-11" loading={busy} disabled={!!refused}>
                Send request
              </Button>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
