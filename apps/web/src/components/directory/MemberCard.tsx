import { PROFESSION_TYPE_LABELS, type DirectoryCardDto, countryName } from "@illuminize/shared";
import { Link } from "react-router-dom";
import { Avatar, Badge, Card } from "@/components/ui";

export function MemberCard({ slug, member }: { slug: string; member: DirectoryCardDto }) {
  return (
    <Link to={`/t/${slug}/app/directory/${member.id}`}>
      <Card className="flex items-center gap-3 p-4 transition hover:border-slate-300 hover:shadow">
        <Avatar name={member.fullName} src={member.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-slate-900">{member.fullName}</span>
            {member.role === "TENANT_ADMIN" && <Badge tone="primary">Admin</Badge>}
            {member.isOpenToWork && <Badge tone="success">Open to work</Badge>}
            {member.isMentor && <Badge tone="info">Mentor</Badge>}
          </div>
          <p className="truncate text-sm text-slate-600">
            {member.designation ? `${member.designation}` : PROFESSION_TYPE_LABELS[member.professionType]}
            {member.companyName ? ` at ${member.companyName}` : ""}
          </p>
          <p className="text-xs text-slate-500">
            Batch of {member.batchYear}
            {member.city ? ` · ${member.city}` : ""}
            {member.country && member.country !== "IN" ? `, ${countryName(member.country)}` : ""}
          </p>
        </div>
      </Card>
    </Link>
  );
}
