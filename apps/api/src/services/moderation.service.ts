import { CHAT_GROUP_MAX_OWNED, MAX_BUSINESS_LISTINGS, type ChatGroupContentDto, type ContentDto, type ContentType, type ModerationItemDto, type ModerationQuery, type PostDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import type { DbClient } from "../db/client";
import { toModerationItemDto } from "../dto/content.dto";
import { toMemberCardDto } from "../dto/membership.dto";
import { countOwnedGroups, findGroupById, findGroupWithOwner, setGroupModeration, type ReviewedText } from "../repositories/chatGroups.repo";
import { lockMembership } from "../repositories/memberships.repo";
import { chatTenantOf } from "./chat/common";
import { announceGroupChange } from "./chat/groups.service";
import { AppError } from "../lib/errors";
import { buildPage, type Page } from "../lib/pagination";
import { runInTransaction } from "../lib/transaction";
import type { ModerationPatch } from "../repositories/content.common";
import { findBusinessById, setBusinessModeration } from "../repositories/businesses.repo";
import { findEventById, setEventModeration } from "../repositories/events.repo";
import { findFundingById, setFundingModeration } from "../repositories/funding.repo";
import { findJobById, setJobModeration } from "../repositories/jobs.repo";
import { findModerationItem, listModerationItems } from "../repositories/moderation.repo";
import { adjustCommentCount, findCommentWithAuthor, findPostById, setCommentModeration, setPostModeration, setPostPinned } from "../repositories/posts.repo";
import { resolveOpenReportsForContent } from "../repositories/reports.repo";
import type { AuthContext, TenantContext } from "../types/request";
import { recordAudit } from "./audit.service";
import { getBusinessForAdmin, hasRoomForBusiness } from "./businesses.service";
import { contentLabel, type ContentActor } from "./content.common";
import { getEventForAdmin } from "./events.service";
import { getFundingForAdmin } from "./funding.service";
import { getJobForAdmin } from "./jobs.service";
import { transitionContent, type ContentAction } from "./moderation";
import { notify } from "./notifications/notification.service";
import { getCommentForAdmin, getPostForAdmin } from "./posts.service";

interface ModeratableRow {
  id: string;
  /** Null for a group nobody is left to own. */
  authorMembershipId: string | null;
  moderationStatus: ModerationPatch["moderationStatus"];
  title: string;
  postId?: string;
}

interface ModeratableRepo {
  find(db: DbClient, tenantId: string, id: string): Promise<ModeratableRow | undefined>;
  /** `from` is what the admin acted on, and `reviewed` what they read, if the action carried it. */
  set(db: DbClient, tenantId: string, id: string, patch: ModerationPatch, from: ModeratableRow["moderationStatus"], reviewed?: ReviewedText): Promise<void>;
  /** Throws if the row can't come back from REMOVED. Shares a transaction with the write. */
  beforeRestore?(db: DbClient, tenantId: string, row: ModeratableRow): Promise<void>;
  afterTransition?(ctx: AppContext, db: DbClient, tenantCtx: TenantContext, row: ModeratableRow, from: ModeratableRow["moderationStatus"], to: ModeratableRow["moderationStatus"]): Promise<void>;
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
    afterTransition: async (_ctx, db, _tenantCtx, row, from, to) => {
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
  BUSINESS: {
    find: async (db, t, id) => {
      const r = await findBusinessById(db, t, id);
      return r && { id: r.id, authorMembershipId: r.authorMembershipId, moderationStatus: r.moderationStatus, title: r.name };
    },
    set: setBusinessModeration,
    // A removed listing frees a place under the member's cap, which may have been taken since.
    beforeRestore: async (db, t, row) => {
      if (row.authorMembershipId && !(await hasRoomForBusiness(db, t, row.authorMembershipId))) {
        throw AppError.conflict(`This member already has ${MAX_BUSINESS_LISTINGS} business listings. One has to go before this one can be restored.`);
      }
    },
  },
  // Its name and description, never its messages. The statement that changes its status also publishes or withdraws what
  // members see (see setGroupModeration), so the room and its review can't disagree.
  GROUP: {
    find: async (db, t, id) => {
      const r = await findGroupById(db, t, id);
      return r && { id: r.conversationId, authorMembershipId: r.ownerMembershipId, moderationStatus: r.moderationStatus, title: r.name };
    },
    // Approving publishes the name and description to every member, and the owner can change both while the group waits
    // without its status moving, so an approval says what it approves and is refused if that's no longer what the group
    // says. Restoring needs nothing: a removed group can't be edited, so it comes back with the text that was approved.
    set: async (db, t, id, patch, from, reviewed) => {
      const publishing = patch.moderationStatus === "APPROVED" && from !== "REMOVED";
      if (publishing && !reviewed) throw AppError.badRequest("Open the group's details, check its name and description, then approve it.");
      if (!(await setGroupModeration(db, t, id, patch, from, publishing ? reviewed : undefined))) throw AppError.conflict("This group changed while you were looking at it. Reload it and try again.");
    },
    // A removed group doesn't count towards its owner's cap, so they may have started others since.
    beforeRestore: async (db, t, row) => {
      if (!row.authorMembershipId) return;
      await lockMembership(db, t, row.authorMembershipId);
      if ((await countOwnedGroups(db, t, row.authorMembershipId)) >= CHAT_GROUP_MAX_OWNED) {
        throw AppError.conflict(`This member already owns ${CHAT_GROUP_MAX_OWNED} groups. One has to be archived before this one can be restored.`);
      }
    },
    // Whatever an admin decided changes what its members and invitees can see, so all of them hear, those it now hides it
    // from included: that's how a removed group leaves their inbox. The hint says nothing of what was decided.
    afterTransition: (ctx, db, tenantCtx, row) => announceGroupChange(ctx, db, chatTenantOf(tenantCtx), row.id, { evenIfHidden: true, invitees: true }),
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
  opts: { skipReportResolution?: boolean; reviewed?: ReviewedText } = {},
): Promise<ModerationResult> {
  const { db } = ctx;
  const repo = REGISTRY[contentType];
  const tenantId = tenantCtx.tenant.id;
  const row = await repo.find(db, tenantId, id);
  if (!row) throw AppError.notFound(`${contentLabel(contentType)} not found`);
  const to = transitionContent(row.moderationStatus, action);
  const write = async (tx: DbClient) => {
    if (action === "restore") await repo.beforeRestore?.(tx, tenantId, row);
    await repo.set(
      tx,
      tenantId,
      id,
      {
        moderationStatus: to,
        moderatedByUserId: actor.userId,
        moderatedAt: new Date(),
        moderationNote: note ?? null,
      },
      row.moderationStatus,
      opts.reviewed,
    );
  };
  // A check needs its write in the same transaction, or two restores could both find the one free place.
  if (action === "restore" && repo.beforeRestore) await runInTransaction(ctx, write);
  else await write(db);
  await repo.afterTransition?.(ctx, db, tenantCtx, row, row.moderationStatus, to);
  await recordAudit(ctx, {
    tenantId,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId ?? null,
    action: `content.${action}`,
    targetType: contentType.toLowerCase(),
    targetId: id,
    metadata: { contentType, from: row.moderationStatus, to, note: note ?? null },
    ip: actor.ip,
  });
  const n = AUTHOR_NOTIFICATIONS[action];
  if (n && row.authorMembershipId) {
    const label = contentLabel(contentType);
    await notify(ctx, {
      tenantId,
      recipientMembershipIds: [row.authorMembershipId],
      type: n.type,
      title: n.title.replace("post", label),
      body: `"${row.title}"${note ? ` — ${note}` : ""}`,
      data: { contentType, contentId: id, status: to, ...(row.postId ? { postId: row.postId } : {}) },
    });
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
    case "BUSINESS":
      return getBusinessForAdmin(ctx, tenantCtx, actor, id);
    case "GROUP":
      return getGroupForAdmin(ctx, tenantCtx.tenant.id, id);
  }
}

/** What an admin reviews of a group: what its owner submitted and what members see now. Its messages are never part of it. */
async function getGroupForAdmin(ctx: AppContext, tenantId: string, id: string): Promise<ChatGroupContentDto> {
  const found = await findGroupWithOwner(ctx.db, tenantId, id);
  if (!found) throw AppError.notFound("Group not found");
  const { group, owner } = found;
  return {
    id: group.conversationId,
    name: group.name,
    description: group.description,
    approvedName: group.approvedName,
    approvedDescription: group.approvedDescription,
    visibility: group.visibility,
    memberCount: group.memberCount,
    owner: owner ? toMemberCardDto(owner) : null,
    archived: !!group.archivedAt,
    moderationStatus: group.moderationStatus,
    moderationNote: group.moderationNote,
    moderatedAt: group.moderatedAt?.toISOString() ?? null,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

/** Id of the stand-in membership the admin routes give platform admins who are not members. */
const SYNTHETIC_MEMBERSHIP_ID = "00000000-0000-0000-0000-000000000000";

export async function setPostPinnedState(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, postId: string, isPinned: boolean): Promise<PostDto> {
  const row = await setPostPinned(ctx.db, tenantCtx.tenant.id, postId, isPinned);
  if (!row) throw AppError.notFound("Post not found");
  await recordAudit(ctx, {
    tenantId: tenantCtx.tenant.id,
    actorUserId: actor.userId,
    // Illuminize staff act without a membership of the institution: record that, not a placeholder id.
    actorMembershipId: actor.membership.id === SYNTHETIC_MEMBERSHIP_ID ? null : actor.membership.id,
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
