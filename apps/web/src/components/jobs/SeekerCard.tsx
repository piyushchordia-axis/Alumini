import { memberYearsLabel, type JobSeekerDto } from "@illuminize/shared";
import { MemberLink } from "@/components/common/MemberLink";
import { Card } from "@/components/ui";
import { timeAgo } from "@/lib/format";

export function SeekerCard({ slug, seeker }: { slug: string; seeker: JobSeekerDto }) {
  return (
    <Card className="p-4">
      <MemberLink
        slug={slug}
        member={seeker.member}
        meta={seeker.member.headline ?? (`${seeker.member.designation ?? ""}${seeker.member.companyName ? ` · ${seeker.member.companyName}` : ""}`.replace(/^ · /, "") || memberYearsLabel(seeker.member))}
      />
      <p className="mt-3 text-sm text-slate-800">{seeker.note}</p>
      <dl className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
        {seeker.preferredRoles && (
          <div>
            <dt className="inline font-medium">Roles: </dt>
            <dd className="inline">{seeker.preferredRoles}</dd>
          </div>
        )}
        {seeker.preferredLocations && (
          <div>
            <dt className="inline font-medium">Locations: </dt>
            <dd className="inline">{seeker.preferredLocations}</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-xs text-slate-400">Updated {timeAgo(seeker.updatedAt)}</p>
    </Card>
  );
}
