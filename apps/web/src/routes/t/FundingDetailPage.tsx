import { FUNDING_STAGE_LABELS } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { BackLink } from "@/components/common/BackLink";
import { ContactLink } from "@/components/common/ContactLink";
import { MemberLink } from "@/components/common/MemberLink";
import { PageLoad } from "@/components/common/PageLoad";
import { RichText } from "@/components/common/RichText";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { ReportButton } from "@/components/moderation/ReportDialog";
import { Badge, Button, Card, LinkButton } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { usePageQuery } from "@/hooks/usePageQuery";
import { api } from "@/lib/api";
import { formatAmountRange, formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function FundingDetailPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const item = useQuery({ queryKey: qk.fundingItem(slug, id), queryFn: () => api.funding.get(slug, id) });
  const page = usePageQuery(item);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["funding", slug] });
  };
  const close = useMutation({ mutationFn: () => api.funding.close(slug, id), onSuccess: () => { invalidate(); toast.success("Listing closed"); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: () => api.funding.remove(slug, id), onSuccess: () => { invalidate(); navigate(`/t/${slug}/app/funding`); }, onError: (e) => toast.error(errorMessage(e)) });
  const back = <BackLink to={`/t/${slug}/app/funding`}>All listings</BackLink>;
  // Only with nothing to show: a refetch failing in the background keeps the listing on screen.
  if (!item.data)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <PageLoad page={page} shape="article" />
      </div>
    );
  const f = item.data;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {back}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{f.title}</h1>
            <p className="text-slate-600">{formatAmountRange(f.amountMinMinor, f.amountMaxMinor, f.currency)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={f.kind === "SEEKING" ? "primary" : "success"}>{f.kind === "SEEKING" ? "Raising" : "Investing"}</Badge>
            {f.stage && <Badge>{FUNDING_STAGE_LABELS[f.stage]}</Badge>}
            {f.isClosed && <Badge>Closed</Badge>}
            <ModerationStatusBadge status={f.moderationStatus} note={f.moderationNote} />
          </div>
        </div>
        <RichText text={f.pitch} className="mt-4" />
        {f.sectors.length > 0 && <p className="mt-3 text-sm text-slate-500">{f.sectors.map((s) => `#${s}`).join("  ")}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          {f.websiteUrl && <ContactLink kind="website" address={f.websiteUrl} />}
          {f.contactEmail && (
            <ContactLink kind="email" address={f.contactEmail} primary>
              Get in touch
            </ContactLink>
          )}
          {f.contactPhone && <ContactLink kind="phone" address={f.contactPhone} />}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <MemberLink slug={slug} member={f.author} meta={`Listed ${formatDate(f.createdAt)}`} />
          <div className="flex items-center gap-2">
            {f.isMine ? (
              <>
                <LinkButton to={`/t/${slug}/app/funding/${f.id}/edit`} variant="outline" size="sm">
                  Edit
                </LinkButton>
                {!f.isClosed && (
                  <Button variant="outline" size="sm" onClick={() => close.mutate()} loading={close.isPending}>
                    Mark closed
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => confirm("Delete this listing?") && remove.mutate()}>
                  Delete
                </Button>
              </>
            ) : (
              <ReportButton slug={slug} contentType="FUNDING" contentId={f.id} />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
