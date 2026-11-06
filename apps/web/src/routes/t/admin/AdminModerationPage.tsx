import {
  ADMIN_REASON_PROMPTS,
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  GROUP_APPROVED_BEFORE_TEXT,
  GROUP_PREVIEW_NOTE,
  MODERATION_EMPTY_TITLE,
  MODERATION_STATUSES,
  MODERATION_STATUS_LABELS,
  MODERATION_SUBTITLE,
  adminContentTarget,
  businessContactLines,
  businessSummaryText,
  canPin,
  contentPreviewKind,
  groupApproval,
  groupBeingEdited,
  groupSeenNext,
  groupSummaryText,
  moderationActionsFor,
  moderationBylineText,
  moderationEmptyText,
  moderationItemKey,
  moderationOutcomeText,
  parseContentType,
  parseModerationStatus,
  pinOutcomeText,
  queueTabCounts,
  reportCountLabel,
  statusTabs,
  type BusinessDto,
  type ChatGroupContentDto,
  type ContentDto,
  type ContentType,
  type GroupReview,
  type JobDto,
  type ModerationItemDto,
  type PostDto,
  type ReasonPromptKey,
  type TenantFeatures,
} from "@illuminize/shared";
import { errorMessage, isOutOfDate, unlessOutOfDate, type ModerationAction } from "@illuminize/shared/client";
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
import { targetHref } from "@/lib/notificationLinks";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

function GroupPreview({ content }: { content: ChatGroupContentDto }) {
  return (
    <div className="space-y-1 text-sm text-slate-800">
      <p className="font-medium">{content.name}</p>
      <p className="text-slate-500">{groupSummaryText(content)}</p>
      {content.description && <p className="whitespace-pre-line">{content.description}</p>}
      {groupBeingEdited(content) && (
        <div className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-slate-600">
          <p className="text-xs font-medium text-slate-500">{GROUP_APPROVED_BEFORE_TEXT}</p>
          <p className="font-medium">{content.approvedName}</p>
          {content.approvedDescription && <p className="whitespace-pre-line">{content.approvedDescription}</p>}
        </div>
      )}
      <p className="text-xs text-slate-500">{GROUP_PREVIEW_NOTE}</p>
    </div>
  );
}

/** A listing with what the list doesn't show: its contact details, as text. */
function BusinessPreview({ content }: { content: BusinessDto }) {
  return (
    <div className="space-y-1 text-sm text-slate-800">
      {content.logoUrl && <img src={content.logoUrl} alt="" className="h-16 w-16 rounded object-cover" />}
      <p className="font-medium">{content.name}</p>
      <p className="text-slate-500">{businessSummaryText(content)}</p>
      <p className="whitespace-pre-line">{content.description}</p>
      {businessContactLines(content).map((v) => (
        <p key={v} className="text-slate-500 [overflow-wrap:anywhere]">
          {v}
        </p>
      ))}
    </div>
  );
}

function PostPreview({ content }: { content: PostDto }) {
  return (
    <div>
      <p className="whitespace-pre-line text-sm text-slate-800">{content.body}</p>
      {content.imageUrls.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {content.imageUrls.map((u) => (
            <img key={u} src={u} alt="" className="h-20 w-20 rounded object-cover" />
          ))}
        </div>
      )}
    </div>
  );
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

/** An item as its type is previewed (contentPreviewKind): a group's name and description, a listing with its contacts, a post, a whole job, or the text. */
function ContentPreview({ type, content }: { type: ContentType; content: ContentDto }) {
  const preview = contentPreviewKind(type, content);
  if (!preview) return null;
  switch (preview.kind) {
    case "group":
      return <GroupPreview content={preview.content} />;
    case "business":
      return <BusinessPreview content={preview.content} />;
    case "post":
      return <PostPreview content={preview.content} />;
    case "job":
      return <JobPreview job={preview.content} />;
    case "text":
      return <p className="whitespace-pre-line text-sm text-slate-800">{preview.text}</p>;
  }
}

type Asking = Extract<ReasonPromptKey, "reject" | "remove">;

export function ModerationRow({ slug, item, features }: { slug: string; item: ModerationItemDto; features: TenantFeatures }) {
  const qc = useQueryClient();
  const [modal, setModal] = useState<Asking | null>(null);
  const [expanded, setExpanded] = useState(false);
  const full = useQuery({ queryKey: qk.admin.content(slug, item.contentType, item.id), queryFn: () => api.admin.moderation.get(slug, item.contentType, item.id), enabled: expanded });
  const refresh = () => {
    void invalidateTenant(qc, slug);
  };
  const act = useMutation({
    mutationFn: (v: { action: ModerationAction; note?: string; reviewed?: { name: string; description: string | null } }) => api.admin.moderation.act(slug, item.contentType, item.id, v.action, v.note, v.reviewed),
    onSuccess: (_r, v) => {
      refresh();
      toast.success(moderationOutcomeText(item.contentType, v.action));
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      // Another admin got there first, or it's gone: what the queue shows is out of date.
      if (isOutOfDate(e)) refresh();
      // Most often a group its owner changed meanwhile: show what it says now.
      else if (expanded) void full.refetch();
    },
  });
  // A group's name and description as its preview first showed them since it opened: what the admin read, which a
  // refresh of the preview meanwhile, as when its owner edits it, mustn't swap just before Approve.
  const [seen, setSeen] = useState<GroupReview | null>(null);
  const seenNext = groupSeenNext(seen, expanded, full.data);
  if (seenNext !== seen) setSeen(seenNext);
  const approve = () => {
    const step = groupApproval(item.contentType, expanded ? full.data : null, seen);
    if (!step.send) {
      if (step.reason === "changed") setSeen(step.seen);
      setExpanded(true);
      if (step.reason === "changed") toast.error(step.hint);
      else toast.info(step.hint);
      return;
    }
    act.mutate({ action: "approve", reviewed: step.reviewed });
  };
  const pin = useMutation({
    mutationFn: (pinned: boolean) => (pinned ? api.admin.moderation.pin(slug, item.id) : api.admin.moderation.unpin(slug, item.id)),
    onSuccess: (_p, pinned) => {
      refresh();
      toast.success(pinOutcomeText(pinned));
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      // Gone, or no longer published: what the queue shows is out of date.
      if (isOutOfDate(e)) refresh();
    },
  });
  const isPinned = item.isPinned;
  const s = item.moderationStatus;
  const can = moderationActionsFor(s);
  const target = adminContentTarget(item.contentType, item.id, features);
  const link = target && targetHref(slug, target, { isAdmin: true });
  const ask = (key: Asking) => {
    const prompt = ADMIN_REASON_PROMPTS[key];
    return (
      <ReasonModal
        open={modal === key}
        title={prompt.title}
        label={prompt.body}
        tone={prompt.tone}
        confirmLabel={prompt.confirm}
        onClose={() => setModal(null)}
        // Out of date (another admin acted first, or it's gone): the toast says so and the modal closes, as trying again can't help.
        onConfirm={(note) => unlessOutOfDate(() => act.mutateAsync({ action: key, note }))}
      />
    );
  };
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
            {isPinned && (
              <Badge className="gap-1">
                <IconPin size={12} />
                Pinned
              </Badge>
            )}
            {item.reportCount > 0 && (
              <Badge tone="danger" className="gap-1">
                <IconFlag size={12} />
                {reportCountLabel(item.reportCount)}
              </Badge>
            )}
            <span className="text-xs text-slate-500">{moderationBylineText(item, timeAgo(item.createdAt))}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-800">{item.title ?? item.excerpt}</p>
          <div className="mt-1 flex gap-3 text-xs">
            <button className="text-primary underline" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
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
              {full.error && !full.data && <ErrorBox error={full.error} />}
              {full.data && <ContentPreview type={item.contentType} content={full.data} />}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {can.includes("approve") && (
            <Button size="sm" onClick={approve} loading={act.isPending && act.variables?.action === "approve"}>
              Approve
            </Button>
          )}
          {can.includes("reject") && (
            <Button size="sm" variant="outline" onClick={() => setModal("reject")}>
              Reject
            </Button>
          )}
          {can.includes("remove") && (
            <Button size="sm" variant="danger" onClick={() => setModal("remove")}>
              Remove
            </Button>
          )}
          {can.includes("restore") && (
            <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "restore" })} loading={act.isPending && act.variables?.action === "restore"}>
              Restore
            </Button>
          )}
          {canPin(item.contentType, s) && (
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => pin.mutate(!isPinned)} loading={pin.isPending}>
              <IconPin size={14} />
              {isPinned ? "Unpin" : "Pin"}
            </Button>
          )}
        </div>
      </div>
      {can.includes("reject") && ask("reject")}
      {can.includes("remove") && ask("remove")}
    </li>
  );
}

export function AdminModerationPage() {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const [params, setParams] = useSearchParams();
  const status = parseModerationStatus(params.get("status"));
  const contentType = parseContentType(params.get("type"));
  const page = Number(params.get("page") ?? "1");
  const query = { status, contentType, page, pageSize: 20 };
  const list = useQuery({ queryKey: qk.admin.moderation(slug, query), queryFn: () => api.admin.moderation.list(slug, query) });
  const dashboard = useQuery({ queryKey: qk.admin.dashboard(slug), queryFn: () => api.admin.dashboard(slug) });
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next);
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Moderation" subtitle={MODERATION_SUBTITLE} />
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={status} onChange={(v) => setParam("status", v)} tabs={statusTabs(MODERATION_STATUSES, MODERATION_STATUS_LABELS, queueTabCounts(dashboard.data)?.moderation)} className="w-fit" />
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
      {list.data && list.data.data.length === 0 && <EmptyState icon={<IconCheck size={32} className="text-slate-400" />} title={MODERATION_EMPTY_TITLE} description={moderationEmptyText(status)} />}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.data?.data.map((item) => (
          <ModerationRow key={moderationItemKey(item)} slug={slug} item={item} features={tenant.settings.features} />
        ))}
      </ul>
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(p) => setParam("page", String(p))} />}
    </div>
  );
}
