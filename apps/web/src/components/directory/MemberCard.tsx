import { type DirectoryCardDto, countryName, memberYearsLine } from "@illuminize/shared";
import { Link } from "react-router-dom";
import { ProfileBadges, profileTagline } from "@/components/profile/ProfileDetails";
import { Avatar, Badge, Card } from "@/components/ui";

export function MemberCard({ slug, member }: { slug: string; member: DirectoryCardDto }) {
  const place = [member.city, member.country && member.country !== "IN" ? countryName(member.country) : null].filter(Boolean).join(", ");
  return (
    <Link to={`/t/${slug}/app/directory/${member.id}`}>
      <Card className="flex items-center gap-3 p-4 transition hover:border-slate-300 hover:shadow">
        <Avatar name={member.fullName} src={member.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-semibold text-slate-900">{member.fullName}</span>
            {member.role === "TENANT_ADMIN" && <Badge tone="primary">Admin</Badge>}
            <ProfileBadges profile={member} short />
          </div>
          {/* One line however long the headline: the whole of it is on their profile. */}
          <p className="truncate text-sm text-slate-600">{profileTagline(member)}</p>
          <p className="text-xs text-slate-500">{memberYearsLine(member, place)}</p>
        </div>
      </Card>
    </Link>
  );
}
