import type { ContentDto, ContentType, ModerationItemDto, ModerationQuery, PostDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import type { DbClient } from "../db/client";
import { toModerationItemDto } from "../dto/content.dto";
import { AppError } from "../lib/errors";
import { buildPage, type Page } from "../lib/pagination";
import type { ModerationPatch } from "../repositories/content.common";
import { findEventById, setEventModeration } from "../repositories/events.repo";
import { findFundingById, setFundingModeration } from "../repositories/funding.repo";
import { findJobById, setJobModeration } from "../repositories/jobs.repo";
import { findModerationItem, listModerationItems } from "../repositories/moderation.repo";
import { adjustCommentCount, findCommentWithAuthor, findPostById, setCommentModeration, setPostModeration, setPostPinned } from "../repositories/posts.repo";
import { resolveOpenReportsForContent } from "../repositories/reports.repo";
import type { AuthContext, TenantContext } from "../types/request";
import { recordAudit } from "./audit.service";
import { contentLabel, type ContentActor } from "./content.common";
import { getEventForAdmin } from "./events.service";
import { getFundingForAdmin } from "./funding.service";
import { getJobForAdmin } from "./jobs.service";
import { transitionContent, type ContentAction } from "./moderation";
import { notify } from "./notifications/notification.service";
import { getCommentForAdmin, getPostForAdmin } from "./posts.service";

interface ModeratableRow {
  id: string;
  authorMembershipId: string;
  moderationStatus: ModerationPatch["moderationStatus"];
  title: string;
  postId?: string;
}

interface ModeratableRepo {
  find(db: DbClient, tenantId: string, id: string): Promise<ModeratableRow | undefined>;
  set(db: DbClient, tenantId: string, id: string, patch: ModerationPatch): Promise<void>;
  afterTransition?(db: DbClient, row: ModeratableRow, from: ModeratableRow["moderationStatus"], to: ModeratableRow["moderationStatus"]): Promise<void>;
}

const REGISTRY: Record<ContentType, ModeratableRepo> = {
  POST: {
    find: async (db, t, id) => {
      const r = await findPostById(db, t, id);
      return r && { id: r.id, authorMembershipId: r.authorMembershipId, moderationStatus: r.moderationStatus, title: r.body.slice(0, 80) };
    },
    set: setPostModeration,
  },
  COMMENT: {
    find: async (db, t, id) => {
      const r = await findCommentWithAuthor(db, t, id);
      return r && { id: r.comment.id, authorMembershipId: r.comment.authorMembershipId, moderationStatus: r.comment.moderationStatus, title: r.comment.body.slice(0, 80), postId: r.comment.postId };
    },
    set: setCommentModeration,
    afterTransition: async (db, row, from, to) => {
      if (!row.postId) return;
      if (from === "APPROVED" && to === "REMOVED") await adjustCommentCount(db, row.postId, -1);
      if (from === "REMOVED" && to === "APPROVED") await adjustCommentCount(db, row.postId, 1);
    },
  },
  JOB: {
    find: async (db, t, id) => {
      const r = await findJobById(db, t, id);
      return r && { id: r.id, authorMembershipId: r.authorMembershipId, moderationStatus: r.moderationStatus, title: r.title };
    },
    set: setJobModeration,
  },
  FUNDING: {
    find: async (db, t, id) => {
      const r = await findFundingById(db, t, id);
      return r && { id: r.id, authorMembershipId: r.authorMembershipId, moderationStatus: r.moderationStatus, title: r.title };
    },
    set: setFundingModeration,
  },
  EVENT: {
    find: async (db, t, id) => {
      const r = await findEventById(db, t, id);
      return r && { id: r.id, authorMembershipId: r.authorMembershipId, moderationStatus: r.moderationStatus, title: r.title };
    },
    set: setEventModeration,
  },
};

interface AdminActor extends AuthContext {
  membershipId?: string | null;
  ip?: string;
}

const AUTHOR_NOTIFICATIONS: Partial<Record<ContentAction, { type: "CONTENT_APPROVED" | "CONTENT_REJECTED" | "CONTENT_REMOVED"; title: string }>> = {
  approve: { type: "CONTENT_APPROVED", title: "Your post is live" },
  reject: { type: "CONTENT_REJECTED", title: "Your post was not approved" },
  remove: { type: "CONTENT_REMOVED", title: "Your post was removed" },
};

export interface ModerationResult {
  contentType: ContentType;
  id: string;
  from: ModeratableRow["moderationStatus"];
  to: ModeratableRow["moderationStatus"];
}

/** One code path for approving / rejecting / removing / restoring any content type. */
export async function moderateContent(
  ctx: AppContext,
  tenantCtx: TenantContext,
  actor: AdminActor,
  contentType: ContentType,
  id: string,
  action: ContentAction,
  note?: string | null,
  opts: { db?: DbClient; skipReportResolution?: boolean } = {},
): Promise<ModerationResult> {
  const db = opts.db ?? ctx.db;
  const repo = REGISTRY[contentType];
  const tenantId = tenantCtx.tenant.id;
  const row = await repo.find(db, tenantId, id);
  if (!row) throw AppError.notFound(`${contentLabel(contentType)} not found`);
  const to = transitionContent(row.moderationStatus, action);
  await repo.set(db, tenantId, id, {
    moderationStatus: to,
    moderatedByUserId: actor.userId,
    moderatedAt: new Date(),
    moderationNote: note ?? null,
  });
  await repo.afterTransition?.(db, row, row.moderationStatus, to);
  await recordAudit(
    ctx,
    {
      tenantId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId ?? null,
      action: `content.${action}`,
      targetType: contentType.toLowerCase(),
      targetId: id,
      metadata: { contentType, from: row.moderationStatus, to, note: note ?? null },
      ip: actor.ip,
    },
    db,
  );
  const n = AUTHOR_NOTIFICATIONS[action];
  if (n) {
    const label = contentLabel(contentType);
    await notify(
      ctx,
      {
        tenantId,
        recipientMembershipIds: [row.authorMembershipId],
        type: n.type,
        title: n.title.replace("post", label),
        body: `"${row.title}"${note ? ` — ${note}` : ""}`,
        data: { contentType, contentId: id, status: to, ...(row.postId ? { postId: row.postId } : {}) },
      },
      db,
    );
  }
  if (to === "REMOVED" && !opts.skipReportResolution) {
    await resolveOpenReportsForContent(db, tenantId, contentType, id, { resolvedByUserId: actor.userId, resolutionNote: "auto: content removed" });
  }
  return { contentType, id, from: row.moderationStatus, to };
}

export async function listModerationQueue(ctx: AppContext, tenantId: string, query: ModerationQuery): Promise<Page<ModerationItemDto>> {
  const { rows, total } = await listModerationItems(ctx.db, tenantId, query);
  return buildPage(
    rows.map((r) => toModerationItemDto(r.item, r.author, r.reportCount)),
    query.page,
    query.pageSize,
    total,
  );
}

export async function getContentForAdmin(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, contentType: ContentType, id: string): Promise<ContentDto> {
  switch (contentType) {
    case "POST":
      return getPostForAdmin(ctx, tenantCtx, actor, id);
    case "COMMENT":
      return getCommentForAdmin(ctx, tenantCtx, actor, id);
    case "JOB":
      return getJobForAdmin(ctx, tenantCtx, actor, id);
    case "FUNDING":
      return getFundingForAdmin(ctx, tenantCtx, actor, id);
    case "EVENT":
      return getEventForAdmin(ctx, tenantCtx, actor, id);
  }
}

export async function setPostPinnedState(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, postId: string, isPinned: boolean): Promise<PostDto> {
  const row = await setPostPinned(ctx.db, tenantCtx.tenant.id, postId, isPinned);
  if (!row) throw AppError.notFound("Post not found");
  await recordAudit(ctx, {
    tenantId: tenantCtx.tenant.id,
    actorUserId: actor.userId,
    actorMembershipId: actor.membership.id,
    action: isPinned ? "content.pin" : "content.unpin",
    targetType: "post",
    targetId: postId,
    ip: actor.ip,
  });
  return getPostForAdmin(ctx, tenantCtx, actor, postId);
}

export async function contentExists(ctx: AppContext, tenantId: string, contentType: ContentType, id: string): Promise<boolean> {
  return !!(await findModerationItem(ctx.db, tenantId, contentType, id));
}
