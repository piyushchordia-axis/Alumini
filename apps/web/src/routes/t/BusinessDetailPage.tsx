import { BUSINESS_CATEGORY_LABELS } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { MemberLink } from "@/components/common/MemberLink";
import { ModerationStatusBadge } from "@/components/moderation/ModerationStatusBadge";
import { ReportButton } from "@/components/moderation/ReportDialog";
import { Avatar, Badge, Button, Card, ErrorBox, LinkButton, Loading } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function BusinessDetailPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const item = useQuery({ queryKey: qk.business(slug, id), queryFn: () => api.businesses.get(slug, id) });
  const remove = useMutation({
    mutationFn: () => api.businesses.remove(slug, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["businesses", slug] });
      navigate(`/t/${slug}/app/businesses`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (item.isLoading) return <Loading />;
  if (item.error || !item.data) return <ErrorBox error={item.error ?? "Not found"} />;
  const b = item.data;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to={`/t/${slug}/app/businesses`} className="text-sm text-slate-500 hover:text-slate-800">
        ← All businesses
      </Link>
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={b.name} src={b.logoUrl} size="lg" />
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900">{b.name}</h1>
              {b.city && <p className="text-slate-600">{b.city}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">{BUSINESS_CATEGORY_LABELS[b.category]}</Badge>
            <ModerationStatusBadge status={b.moderationStatus} note={b.moderationNote} />
          </div>
        </div>
        <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-slate-800">{b.description}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {b.websiteUrl && (
            <a href={b.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm">
              🌐 Website
            </a>
          )}
          {b.contactEmail && (
            <a href={`mailto:${b.contactEmail}`} className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm">
              ✉️ {b.contactEmail}
            </a>
          )}
          {b.contactPhone && (
            <a href={`tel:${b.contactPhone}`} className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm">
              📞 {b.contactPhone}
            </a>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <MemberLink slug={slug} member={b.author} meta={`Listed ${formatDate(b.createdAt)}`} />
          <div className="flex items-center gap-2">
            {b.isMine ? (
              <>
                <LinkButton to={`/t/${slug}/app/businesses/${b.id}/edit`} variant="outline" size="sm">
                  Edit
                </LinkButton>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
                <ConfirmDialog open={confirmingDelete} title="Delete this listing?" confirmLabel="Delete listing" destructive busy={remove.isPending} onConfirm={() => remove.mutate()} onCancel={() => setConfirmingDelete(false)} />
              </>
            ) : (
              <ReportButton slug={slug} contentType="BUSINESS" contentId={b.id} />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
