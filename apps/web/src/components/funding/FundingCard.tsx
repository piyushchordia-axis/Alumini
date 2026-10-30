import { FUNDING_STAGE_LABELS, type FundingDto } from "@illuminize/shared";
import { Link } from "react-router-dom";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { Badge, Card } from "@/components/ui";
import { formatAmountRange, timeAgo } from "@/lib/format";

export function FundingCard({ slug, item }: { slug: string; item: FundingDto }) {
  return (
    <Link to={`/t/${slug}/app/funding/${item.id}`}>
      <Card className="p-4 transition hover:border-slate-300 hover:shadow">
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
        <p className="mt-2 line-clamp-2 text-sm text-slate-600">{item.pitch}</p>
        {item.sectors.length > 0 && <p className="mt-2 text-xs text-slate-500">{item.sectors.map((s) => `#${s}`).join(" ")}</p>}
        <p className="mt-2 text-xs text-slate-400">
          {item.author.fullName} · batch of {item.author.batchYear} · {timeAgo(item.createdAt)}
        </p>
      </Card>
    </Link>
  );
}
