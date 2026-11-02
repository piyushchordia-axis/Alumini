import { BUSINESS_CATEGORY_LABELS, type BusinessCardDto } from "@illuminize/shared";
import { ContentCard } from "@/components/moderation/ContentCard";
import { ModerationCardNote, ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { Avatar, Badge } from "@/components/ui";
import { timeAgo } from "@/lib/format";

export function BusinessCard({ slug, item }: { slug: string; item: BusinessCardDto }) {
  return (
    <ContentCard to={`/t/${slug}/app/businesses/${item.id}`} status={item.moderationStatus} className="p-4">
      <div className="flex items-start gap-3">
        <Avatar name={item.name} src={item.logoUrl} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-slate-900">{item.name}</h3>
          {item.city && <p className="truncate text-sm text-slate-600">{item.city}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone="info">{BUSINESS_CATEGORY_LABELS[item.category]}</Badge>
          <ModerationStatusBadge status={item.moderationStatus} />
        </div>
      </div>
      <ModerationCardNote status={item.moderationStatus} note={item.moderationNote} />
      <p className="mt-2 line-clamp-2 text-sm text-slate-600">{item.description}</p>
      <p className="mt-2 text-xs text-slate-400">
        {item.author.fullName} · batch of {item.author.batchYear} · {timeAgo(item.createdAt)}
      </p>
    </ContentCard>
  );
}
