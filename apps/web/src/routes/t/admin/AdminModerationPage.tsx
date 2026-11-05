import {
  BUSINESS_CATEGORY_LABELS,
  CHAT_GROUP_VISIBILITY_INFO,
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  MODERATION_STATUSES,
  MODERATION_STATUS_LABELS,
  type ChatGroupContentDto,
  type ContentDto,
  type ContentType,
  type JobDto,
  type ModerationItemDto,
  type ModerationStatus,
} from "@illuminize/shared";
import { errorMessage, type ModerationAction } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ReasonModal } from "@/components/admin/ReasonModal";
import { IconAnnounce, IconCheck, IconExternalLink, IconFlag, IconPin } from "@/components/icons";
import { JobApplyArea } from "@/components/jobs/JobApplyArea";
import { AboutCompany, JobDetails } from "@/components/jobs/JobDetails";
import { Badge, Button, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Select, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { invalidateTenant } from "@/lib/invalidate";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

/** Where to see the item in the app. No default: a content type added without an answer here is a compile error. */
function contentLink(slug: string, item: ModerationItemDto): string | null {
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
    case "BUSINESS":
      return `${base}/businesses/${item.id}`;
    // A group's page would be its members' conversation, which admins don't get to open.
    case "GROUP":
    case "COMMENT":
      return null;
  }
}

function GroupPreview({ content }: { content: ChatGroupContentDto }) {
  const editing = content.approvedName !== null && (content.approvedName !== content.name || content.approvedDescription !== content.description);
  return (
    <div className="space-y-1 text-sm text-slate-800">
      <p className="font-medium">{content.name}</p>
      <p className="text-slate-500">
        {CHAT_GROUP_VISIBILITY_INFO[content.visibility].label} · {content.memberCount} {content.memberCount === 1 ? "member" : "members"}
        {content.owner ? ` · owned by ${content.owner.fullName}` : ""}
      </p>
      {content.description && <p className="whitespace-pre-line">{content.description}</p>}
      {editing && (
        <div className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-slate-600">
          <p className="text-xs font-medium text-slate-500">Until you decide, members see what was approved before:</p>
          <p className="font-medium">{content.approvedName}</p>
          {content.approvedDescription && <p className="whitespace-pre-line">{content.approvedDescription}</p>}
        </div>
      )}
      <p className="text-xs text-slate-500">Chat messages are never shown here: only a group's name and description are reviewed.</p>
    </div>
  );
}

function ContentPreview({ content }: { content: ContentDto }) {
  // First: a group has a description too, and it's a different thing to review.
  if ("visibility" in content && "memberCount" in content) return <GroupPreview content={content} />;
  // Before the description check below: a business has one too, and an admin also needs what the list doesn't show.
  if ("category" in content) {
    return (
      <div className="space-y-1 text-sm text-slate-800">
        {content.logoUrl && <img src={content.logoUrl} alt="" className="h-16 w-16 rounded object-cover" />}
        <p className="font-medium">{content.name}</p>
        <p className="text-slate-500">{[BUSINESS_CATEGORY_LABELS[content.category], content.city].filter(Boolean).join(" · ")}</p>
        <p className="whitespace-pre-line">{content.description}</p>
        {[content.websiteUrl, content.contactEmail, content.contactPhone].filter(Boolean).map((v) => (
          <p key={v} className="text-slate-500">
            {v}
          </p>
        ))}
      </div>
    );
  }
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
  // Before the description check below: an event has one too, and an admin approving a job needs every part of it.
  if ("companyName" in content) return <JobPreview job={content} />;
  if ("description" in content) return <p className="whitespace-pre-line text-sm text-slate-800">{content.description}</p>;
  return null;
}

/** The whole job as its page shows it, with its contacts as text and its How to apply even once closed: all of what's approved. */
function JobPreview({ job }: { job: JobDto }) {
  const [now] = useState(() => Date.now());
  return (
    <div className="space-y-4 text-sm">
      <JobDetails job={job} now={now} level={2} showClosedSections apply={<JobApplyArea job={job} now={now} plain />} />
      <AboutCompany job={job} level={2} plain className="border-t border-slate-200 pt-4" />
    </div>
  );
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
    mutationFn: (v: { action: ModerationAction; note?: string; reviewed?: { name: string; description: string | null } }) => api.admin.moderation.act(slug, item.contentType, item.id, v.action, v.note, v.reviewed),
    onSuccess: (r) => {
      refresh();
      toast.success(`${CONTENT_TYPE_LABELS[item.contentType]} ${r.to.toLowerCase()}`);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      // Most often a group its owner changed meanwhile: show what it says now.
      if (expanded) void full.refetch();
    },
  });
  const shownGroup = full.data && "visibility" in full.data && "memberCount" in full.data ? full.data : null;
  /**
   * Approving a group publishes its name and description to its members, so it approves what this admin can see on screen:
   * the first press opens the details if they're closed, and the API refuses if the group has changed since.
   */
  const approve = () => {
    if (item.contentType !== "GROUP") return act.mutate({ action: "approve" });
    if (!expanded || !shownGroup) {
      setExpanded(true);
      toast.info("Check the group's name and description, then approve it.");
      return;
    }
    act.mutate({ action: "approve", reviewed: { name: shownGroup.name, description: shownGroup.description } });
  };
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
  const link = contentLink(slug, item);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        {/* The whole width on a phone, with the actions below, or a long item reads as a narrow column. */}
        <div className="min-w-0 flex-1 max-sm:basis-full">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{CONTENT_TYPE_LABELS[item.contentType]}</Badge>
            {item.kind === "ANNOUNCEMENT" && (
              <Badge tone="primary" className="gap-1">
                <IconAnnounce size={12} />
                Announcement
              </Badge>
            )}
            {item.reportCount > 0 && (
              <Badge tone="danger" className="gap-1">
                <IconFlag size={12} />
                {item.reportCount} report(s)
              </Badge>
            )}
            <span className="text-xs text-slate-500">
              {item.author ? `by ${item.author.fullName} (batch of ${item.author.batchYear})` : "by a deleted member"} · {timeAgo(item.createdAt)}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-800">{item.title ?? item.excerpt}</p>
          <div className="mt-1 flex gap-3 text-xs">
            <button className="text-primary underline" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Hide" : "View full content"}
            </button>
            {link && (
              <Link to={link} className="inline-flex items-center gap-1 text-slate-500 underline" target="_blank">
                Open in app
                <IconExternalLink size={14} />
                <span className="sr-only"> (opens in a new tab)</span>
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
            <Button size="sm" onClick={approve} loading={act.isPending}>
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
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => pin.mutate(!isPinned)} loading={pin.isPending}>
              <IconPin size={14} />
              {isPinned ? "Unpin" : "Pin"}
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
      {list.data && list.data.data.length === 0 && <EmptyState icon={<IconCheck size={32} className="text-slate-400" />} title="Nothing to review" description={`No ${MODERATION_STATUS_LABELS[status].toLowerCase()} content.`} />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.data?.data.map((item) => (
          <ModerationRow key={`${item.contentType}:${item.id}`} slug={slug} item={item} />
        ))}
      </ul>
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParam("page", String(p))} />}
    </div>
  );
}
