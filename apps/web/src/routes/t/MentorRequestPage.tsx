import { MENTORSHIP_NOTE_MAX_LENGTH, memberRoleLine, memberYearsLabel, mentorshipNoteHelp, mentorshipNoteSchema } from "@illuminize/shared";
import { fatalQueryError, isApiClientError } from "@illuminize/shared/client";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MentorAreas } from "@/components/mentors/MentorCard";
import { MentorUnavailable, mentorUnavailableText } from "@/components/mentors/MentorUnavailable";
import { Avatar, Button, Card, ErrorBox, Loading, PageHeader, Textarea } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { mentorPath, mentorsPath, refreshMentorship } from "@/lib/mentors";
import { MentorAction, useMentor } from "@/routes/t/MentorDetailPage";
import { toast } from "@/stores/uiStore";

/** Remounts per mentor, so a note written to one is never sent to another. */
export function MentorRequestRoute() {
  const { membershipId = "" } = useParams();
  return <MentorRequestPage key={membershipId} id={membershipId} />;
}

/**
 * Request mentorship: a note, said up front to be what the mentor reads and, if they accept, the chat's first message. A
 * refetch of the mentor failing in the background keeps the form and the note, and so does one the API refuses once the form
 * is up (the mentor stopped, say): it says so above the note, which stays there to copy, and nothing can be sent.
 */
function MentorRequestPage({ id }: { id: string }) {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const query = useMentor(slug, id);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();

  const error = fatalQueryError(query);
  if (error && !query.data) return <MentorUnavailable slug={slug} error={error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const m = query.data;
  const refused = error ? mentorUnavailableText(error) : null;
  const name = m.member.fullName;
  if (m.isMe) return <MentorUnavailable slug={slug} title="You can't ask yourself" text="This is your own mentor profile." />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (refused) return;
    setServerError(null);
    const parsed = mentorshipNoteSchema.safeParse(note);
    if (!parsed.success) {
      setNoteError(parsed.error.issues[0]?.message);
      return;
    }
    setNoteError(undefined);
    setBusy(true);
    try {
      await api.mentorship.request(slug, { mentorMembershipId: m.member.id, note: parsed.data });
      toast.success("Request sent");
      // In place of this form, so going back from Requests lands on the mentor rather than on a form that would ask again.
      navigate(mentorsPath(slug, "requests", "sent"), { replace: true });
      void refreshMentorship(qc, slug);
    } catch (err) {
      const fieldError = isApiClientError(err) ? err.fieldErrors.note : undefined;
      if (fieldError) setNoteError(fieldError);
      else setServerError(err);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={mentorPath(slug, m.member.id)} className="text-sm text-slate-500 hover:text-slate-800">
        ← {name}
      </Link>
      <PageHeader title="Request mentorship" />
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <Avatar name={name} src={m.member.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{name}</p>
            <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">{memberRoleLine(m.member)}</p>
            <p className="text-xs text-slate-500">{memberYearsLabel(m.member)}</p>
            <div className="mt-2">
              <MentorAreas areas={m.areas} />
            </div>
          </div>
        </div>
        <div className="mt-5 border-t border-slate-100 pt-5">
          {m.myRequest ? (
            // Asked already, perhaps in another tab: one open request per mentor, so there's nothing to send.
            <MentorAction slug={slug} mentor={m} />
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
                  Note to the mentor
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
                  maxLength={MENTORSHIP_NOTE_MAX_LENGTH}
                  invalid={!!noteError}
                  aria-invalid={!!noteError}
                  aria-required="true"
                  aria-describedby={`${noteError ? `${fieldId}-error ` : ""}${fieldId}-help ${fieldId}-count`}
                  autoComplete="off"
                  placeholder="Say who you are, what you'd like help with, and why you're asking them."
                />
                {noteError && (
                  <p id={`${fieldId}-error`} className="mt-1 text-xs text-red-600" role="alert">
                    {noteError}
                  </p>
                )}
                <p className="mt-1 flex justify-between gap-2 text-xs text-slate-500">
                  <span id={`${fieldId}-help`}>{mentorshipNoteHelp(name)}</span>
                  <span id={`${fieldId}-count`} className="shrink-0 tabular-nums">
                    {note.length} / {MENTORSHIP_NOTE_MAX_LENGTH}
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
