import { MENTOR_AREA_LABELS, MENTOR_AVAILABILITY_LABELS, memberRoleLine, mentorCardLabel, type MentorArea, type MentorCardDto } from "@illuminize/shared";
import { Link } from "react-router-dom";
import { Avatar, Badge, Card } from "@/components/ui";
import { mentorPath } from "@/lib/mentors";

/** A mentor's areas, each its own badge, wrapping on a phone. */
export function MentorAreas({ areas }: { areas: MentorArea[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Mentor areas">
      {areas.map((a) => (
        <li key={a}>
          <Badge tone="primary">{MENTOR_AREA_LABELS[a]}</Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * One mentor in Find mentors. The name opens their page, and the whole card is that link's target area. The link is named
 * for everything the card shows, starting with the name it shows, as the mobile app's card is.
 */
export function MentorCard({ slug, mentor }: { slug: string; mentor: MentorCardDto }) {
  const { member } = mentor;
  return (
    <Card as="article" className="relative p-4 transition focus-within:ring-2 focus-within:ring-primary/30 hover:border-slate-300 hover:shadow">
      <div className="flex items-start gap-3">
        <Avatar name={member.fullName} src={member.avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-900 [overflow-wrap:anywhere]">
            <Link to={mentorPath(slug, member.id)} aria-label={mentorCardLabel(mentor)} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
              {member.fullName}
            </Link>
          </h3>
          <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">{memberRoleLine(member)}</p>
          <p className="text-xs text-slate-500">
            Batch of {member.batchYear}
            {member.city ? ` · ${member.city}` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <MentorAreas areas={mentor.areas} />
      </div>
      <p className="mt-2 text-xs text-slate-500">Availability: {MENTOR_AVAILABILITY_LABELS[mentor.availability]}</p>
    </Card>
  );
}
