import { CONTENT_TYPES, CONTENT_TYPE_LABELS, MODERATION_STATUSES, MODERATION_STATUS_LABELS, type ContentDto, type ContentType, type ModerationItemDto, type ModerationStatus } from "@illuminize/shared";
import { errorMessage, type ModerationAction } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ReasonModal } from "@/components/admin/ReasonModal";
import { Badge, Button, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Select, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { invalidateTenant } from "@/lib/invalidate";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

function contentLink(slug: string, item: ModerationItemDto): string {
  const base = `/t/${slug}/app`;
  switch (item.contentType) {
    case "POST":
      return `${base}/feed/${item.id}`;
    case "JOB":
      return `${base}/jobs/${item.id}`;
    case "FUNDING":
      return `${base}/funding/${item.id}`;
    case "EVENT":
      return `${base}/events/${item.id}`;
    default:
      return `${base}/feed`;
  }
}

function ContentPreview({ content }: { content: ContentDto }) {
  if ("body" in content && "imageUrls" in content) {
    return (
      <div>
        <p className="whitespace-pre-line text-sm text-slate-800">{content.body}</p>
        {content.imageUrls.length > 0 && (
          <div className="mt-2 flex gap-2">
            {content.imageUrls.map((u) => (
              <img key={u} src={u} alt="" className="h-20 w-20 rounded object-cover" />
            ))}
          </div>
        )}
      </div>
    );
  }
  if ("body" in content) return <p className="text-sm text-slate-800">{content.body}</p>;
  if ("pitch" in content) return <p className="whitespace-pre-line text-sm text-slate-800">{content.pitch}</p>;
  if ("description" in content) return <p className="whitespace-pre-line text-sm text-slate-800">{content.description}</p>;
  return null;
}

export function ModerationRow({ slug, item }: { slug: string; item: ModerationItemDto }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<"reject" | "remove" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const full = useQuery({ queryKey: ["admin", slug, "content", item.contentType, item.id], queryFn: () => api.admin.moderation.get(slug, item.contentType, item.id), enabled: expanded });
  const refresh = () => {
    void invalidateTenant(qc, slug);
  };
  const act = useMutation({
    mutationFn: (v: { action: ModerationAction; note?: string }) => api.admin.moderation.act(slug, item.contentType, item.id, v.action, v.note),
    onSuccess: (r) => {
      refresh();
      toast.success(`${CONTENT_TYPE_LABELS[item.contentType]} ${r.to.toLowerCase()}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pin = useMutation({
    mutationFn: (pinned: boolean) => (pinned ? api.admin.moderation.pin(slug, item.id) : api.admin.moderation.unpin(slug, item.id)),
    onSuccess: () => {
      refresh();
      toast.success("Updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const isPinned = item.isPinned;
  const s = item.moderationStatus;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{CONTENT_TYPE_LABELS[item.contentType]}</Badge>
            {item.reportCount > 0 && <Badge tone="danger">🚩 {item.reportCount} report(s)</Badge>}
            <span className="text-xs text-slate-500">
              by {item.author.fullName} (batch of {item.author.batchYear}) · {timeAgo(item.createdAt)}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-800">{item.title ?? item.excerpt}</p>
          <div className="mt-1 flex gap-3 text-xs">
            <button className="text-primary underline" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Hide" : "View full content"}
            </button>
            {item.contentType !== "COMMENT" && (
              <Link to={contentLink(slug, item)} className="text-slate-500 underline" target="_blank">
                Open in app ↗
              </Link>
            )}
          </div>
          {expanded && (
            <div className="mt-2 rounded-lg bg-slate-50 p-3">
              {full.isLoading && <Loading />}
              {full.data && <ContentPreview content={full.data} />}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(s === "PENDING" || s === "REJECTED") && (
            <Button size="sm" onClick={() => act.mutate({ action: "approve" })} loading={act.isPending}>
              Approve
            </Button>
          )}
          {s === "PENDING" && (
            <Button size="sm" variant="outline" onClick={() => setModal("reject")}>
              Reject
            </Button>
          )}
          {s === "APPROVED" && (
            <Button size="sm" variant="danger" onClick={() => setModal("remove")}>
              Remove
            </Button>
          )}
          {s === "REMOVED" && (
            <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "restore" })} loading={act.isPending}>
              Restore
            </Button>
          )}
          {s === "APPROVED" && item.contentType === "POST" && (
            <Button size="sm" variant="ghost" onClick={() => pin.mutate(!isPinned)} loading={pin.isPending}>
              {isPinned ? "Unpin" : "📌 Pin"}
            </Button>
          )}
        </div>
      </div>
      <ReasonModal open={modal === "reject"} title="Reject this content?" label="The author sees your note and can edit and resubmit." tone="danger" confirmLabel="Reject" onClose={() => setModal(null)} onConfirm={(note) => act.mutateAsync({ action: "reject", note })} />
      <ReasonModal open={modal === "remove"} title="Remove this content?" label="It disappears for members; you can restore it later." tone="danger" confirmLabel="Remove" onClose={() => setModal(null)} onConfirm={(note) => act.mutateAsync({ action: "remove", note })} />
    </li>
  );
}

export function AdminModerationPage() {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") as ModerationStatus) || "PENDING";
  const contentType = (params.get("type") as ContentType) || undefined;
  const page = Number(params.get("page") ?? "1");
  const query = { status, contentType, page, pageSize: 20 };
  const list = useQuery({ queryKey: qk.admin.moderation(slug, query), queryFn: () => api.admin.moderation.list(slug, query) });
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next);
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Moderation" subtitle="Review what members post before (or after) it goes live" />
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={status} onChange={(v) => setParam("status", v)} tabs={MODERATION_STATUSES.map((s) => ({ value: s, label: MODERATION_STATUS_LABELS[s] }))} className="w-fit" />
        <Select aria-label="Content type" value={contentType ?? ""} onChange={(e) => setParam("type", e.target.value)} className="w-44">
          <option value="">All types</option>
          {CONTENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {CONTENT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>
      {list.isLoading && <Loading />}
      {list.error && <ErrorBox error={list.error} />}
      {list.data && list.data.data.length === 0 && <EmptyState icon="✅" title="Nothing to review" description={`No ${MODERATION_STATUS_LABELS[status].toLowerCase()} content.`} />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.data?.data.map((item) => (
          <ModerationRow key={`${item.contentType}:${item.id}`} slug={slug} item={item} />
        ))}
      </ul>
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParam("page", String(p))} />}
    </div>
  );
}
