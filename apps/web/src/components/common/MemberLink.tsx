import { memberYearsLine, type MemberCardDto } from "@illuminize/shared";
import { Link } from "react-router-dom";
import { Avatar } from "@/components/ui";

/** A member's photo and name, linking to their profile. The grey line under the name always starts with their years, then `meta` (or their company). */
export function MemberLink({ slug, member, meta, size = "md" }: { slug: string; member: MemberCardDto; meta?: string; size?: "sm" | "md" }) {
  return (
    <Link to={`/t/${slug}/app/directory/${member.id}`} className="flex min-w-0 items-center gap-2">
      <Avatar name={member.fullName} src={member.avatarUrl} size={size} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-900">{member.fullName}</span>
        <span className="block truncate text-xs text-slate-500">{memberYearsLine(member, meta ?? member.companyName)}</span>
      </span>
    </Link>
  );
}
