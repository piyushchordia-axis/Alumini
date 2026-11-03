import { memberRoleLine, mentorAvailabilityText, mentorshipKeys, type MentorDto } from "@illuminize/shared";
import { fatalQueryError } from "@illuminize/shared/client";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { MentorAreas } from "@/components/mentors/MentorCard";
import { MentorUnavailable } from "@/components/mentors/MentorUnavailable";
import { Avatar, Card, LinkButton, Loading } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { mentorRequestPath, mentorsPath } from "@/lib/mentors";

/** One mentor's page, shared with the request form, which needs the same mentor and whether they've been asked already. */
export function useMentor(slug: string, membershipId: string) {
  return useQuery({ queryKey: mentorshipKeys.mentor(slug, membershipId), queryFn: () => api.mentorship.mentor(slug, membershipId) });
}

const firstName = (fullName: string) => fullName.split(/\s+/)[0] ?? fullName;

/** What this member can do about this mentor: ask, see where their request stands, or open the chat it led to. */
export function MentorAction({ slug, mentor }: { slug: string; mentor: MentorDto }) {
  const name = mentor.member.fullName;
  const action = "inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary";
  if (mentor.isMe)
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">This is how members see your mentor profile.</p>
        <Link to={mentorsPath(slug, "be-a-mentor")} className={action}>
          Edit mentor profile
        </Link>
      </div>
    );
  const mine = mentor.myRequest;
  if (mine?.status === "ACCEPTED")
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">{firstName(name)} is your mentor.</p>
        {mine.conversationId && (
          <LinkButton to={`/t/${slug}/app/messages/${mine.conversationId}`} className="min-h-11">
            Open chat
          </LinkButton>
        )}
      </div>
    );
  if (mine)
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">You've asked {firstName(name)} to mentor you. Their answer will show in Requests.</p>
        <Link to={mentorsPath(slug, "requests", "sent")} className={action}>
          See your request
        </Link>
      </div>
    );
  return (
    <LinkButton to={mentorRequestPath(slug, mentor.member.id)} className="min-h-11">
      Request mentorship
    </LinkButton>
  );
}

/** Remounts per mentor, so nothing from one carries into the next. */
export function MentorDetailRoute() {
  const { membershipId = "" } = useParams();
  return <MentorDetailPage key={membershipId} id={membershipId} />;
}

/** A mentor's own page: who they are, what they can help with, when, in their own words, and Request mentorship. */
function MentorDetailPage({ id }: { id: string }) {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const query = useMentor(slug, id);
  // Only an answer, or nothing at all to show: a refetch failing in the background keeps the page.
  const error = fatalQueryError(query);
  if (error) return <MentorUnavailable slug={slug} error={error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const m = query.data;
  const { member } = m;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={mentorsPath(slug)} className="text-sm text-slate-500 hover:text-slate-800">
        ← Mentors
      </Link>
      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <Avatar name={member.fullName} src={member.avatarUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-slate-900 [overflow-wrap:anywhere]">{member.fullName}</h1>
            <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">{memberRoleLine(member)}</p>
            <p className="text-sm text-slate-500">
              Batch of {member.batchYear}
              {member.city ? ` · ${member.city}` : ""}
            </p>
            {tenant.settings.features.directory && (
              <Link to={`/t/${slug}/app/directory/${member.id}`} className="mt-1 inline-flex min-h-11 items-center text-sm text-primary underline">
                View full profile
              </Link>
            )}
          </div>
        </div>
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Can help with</h2>
          <MentorAreas areas={m.areas} />
        </section>
        <section className="mt-4">
          <h2 className="text-sm font-semibold text-slate-700">Availability</h2>
          <p className="mt-0.5 text-sm text-slate-800 [overflow-wrap:anywhere]">{mentorAvailabilityText(m)}</p>
        </section>
        {m.note && (
          <section className="mt-4">
            <h2 className="text-sm font-semibold text-slate-700">About their mentoring</h2>
            <p className="mt-0.5 whitespace-pre-line text-[15px] leading-relaxed text-slate-800 [overflow-wrap:anywhere]">{m.note}</p>
          </section>
        )}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <MentorAction slug={slug} mentor={m} />
        </div>
      </Card>
    </div>
  );
}
