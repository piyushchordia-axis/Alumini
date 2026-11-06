import { FUNDING_STAGE_LABELS, memberYearsLabel, plainExcerpt, type FundingDto } from "@illuminize/shared";
import { ContentCard } from "@/components/moderation/ContentCard";
import { ModerationCardNote, ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { Badge } from "@/components/ui";
import { formatAmountRange, timeAgo } from "@/lib/format";

export function FundingCard({ slug, item }: { slug: string; item: FundingDto }) {
  return (
    <ContentCard to={`/t/${slug}/app/funding/${item.id}`} status={item.moderationStatus} className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-slate-900">{item.title}</h3>
          <p className="text-sm text-slate-600">{formatAmountRange(item.amountMinMinor, item.amountMaxMinor, item.currency)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={item.kind === "SEEKING" ? "primary" : "success"}>{item.kind === "SEEKING" ? "Raising" : "Investing"}</Badge>
          {item.stage && <Badge>{FUNDING_STAGE_LABELS[item.stage]}</Badge>}
          {item.isClosed && <Badge>Closed</Badge>}
          <ModerationStatusBadge status={item.moderationStatus} />
        </div>
      </div>
      <ModerationCardNote status={item.moderationStatus} note={item.moderationNote} />
      <p className="mt-2 line-clamp-2 text-sm text-slate-600 [overflow-wrap:anywhere]">{plainExcerpt(item.pitch, 200)}</p>
      {item.sectors.length > 0 && <p className="mt-2 text-xs text-slate-500">{item.sectors.map((s) => `#${s}`).join(" ")}</p>}
      <p className="mt-2 text-xs text-slate-500">
        {item.author.fullName} · {memberYearsLabel(item.author)} · {timeAgo(item.createdAt)}
      </p>
    </ContentCard>
  );
}
