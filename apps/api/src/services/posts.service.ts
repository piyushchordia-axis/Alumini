import type {
  CommentCreateInput,
  CommentDto,
  CursorPage,
  PostCreateInput,
  PostDto,
  PostListQuery,
  PostPageDto,
  PostUpdateInput,
  ReactionEntryDto,
  ReactionSummaryDto,
  ReactionType,
} from "@illuminize/shared";
import type { AppContext } from "../context";
import { toCommentDto, toPostDto, toReactionEntryDto } from "../dto/content.dto";
import { AppError } from "../lib/errors";
import {
  adjustCommentCount,
  deleteComment,
  deletePost,
  deleteReaction,
  findCommentWithAuthor,
  findPostWithAuthor,
  findReaction,
  insertComment,
  insertPost,
  listComments,
  listPinnedPosts,
  listPosts,
  listReactions,
  recountReactions,
  updatePost,
  upsertReaction,
} from "../repositories/posts.repo";
import type { TenantContext } from "../types/request";
import { afterContentWrite, assertAuthor, assertAuthorOrAdmin, assertCanView, initialStatusFor, statusAfterEdit, type ContentActor, viewerFlags, viewerOf } from "./content.common";
import { notify } from "./notifications/notification.service";

export async function listTenantPosts(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: PostListQuery): Promise<PostPageDto> {
  const tenantId = tenantCtx.tenant.id;
  const page = await listPosts(ctx.db, tenantId, query, actor.membership.id);
  const result: PostPageDto = { data: page.data.map((r) => toPostDto(r, viewerOf(actor))), nextCursor: page.nextCursor };
  if (!query.cursor && !query.mine) {
    const pinned = await listPinnedPosts(ctx.db, tenantId, actor.membership.id);
    result.pinned = pinned.map((r) => toPostDto(r, viewerOf(actor)));
  }
  return result;
}

export async function createPost(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, input: PostCreateInput): Promise<PostDto> {
  const status = initialStatusFor(tenantCtx, actor, "POST");
  const row = await insertPost(ctx.db, {
    tenantId: tenantCtx.tenant.id,
    authorMembershipId: actor.membership.id,
    body: input.body,
    imageUrls: input.imageUrls ?? [],
    moderationStatus: status,
    moderatedAt: status === "APPROVED" ? new Date() : null,
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "POST", id: row.id, title: row.body, status, action: "create" });
  return toPostDto({ post: row, author: actor.membership, myReaction: null }, viewerOf(actor));
}

async function loadPost(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string) {
  const found = await findPostWithAuthor(ctx.db, tenantCtx.tenant.id, id, actor.membership.id);
  if (!found) throw AppError.notFound("Post not found");
  return found;
}

export async function getPost(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<PostDto> {
  const found = await loadPost(ctx, tenantCtx, actor, id);
  assertCanView(actor, found.post.moderationStatus, found.post.authorMembershipId, "Post", found.author.status);
  return toPostDto(found, viewerOf(actor));
}

export async function getPostForAdmin(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<PostDto> {
  return toPostDto(await loadPost(ctx, tenantCtx, actor, id), viewerOf(actor));
}

export async function updatePostBody(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, input: PostUpdateInput): Promise<PostDto> {
  const found = await loadPost(ctx, tenantCtx, actor, id);
  assertAuthor(actor, found.post.authorMembershipId);
  const status = statusAfterEdit(tenantCtx, actor, found.post.moderationStatus);
  const row = (await updatePost(ctx.db, tenantCtx.tenant.id, id, {
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.imageUrls !== undefined ? { imageUrls: input.imageUrls } : {}),
    moderationStatus: status,
    moderationNote: status === found.post.moderationStatus ? found.post.moderationNote : null,
  }))!;
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "POST", id, title: row.body, status, action: "update" });
  return toPostDto({ post: row, author: found.author, myReaction: found.myReaction }, viewerOf(actor));
}

export async function removePost(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<void> {
  const found = await loadPost(ctx, tenantCtx, actor, id);
  assertAuthor(actor, found.post.authorMembershipId);
  await deletePost(ctx.db, tenantCtx.tenant.id, id);
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "POST", id, title: found.post.body, status: found.post.moderationStatus, action: "delete" });
}

// ---- comments ----

async function loadVisiblePost(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, postId: string) {
  const found = await loadPost(ctx, tenantCtx, actor, postId);
  assertCanView(actor, found.post.moderationStatus, found.post.authorMembershipId, "Post", found.author.status);
  return found;
}

export async function listPostComments(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, postId: string, query: { cursor?: string; limit: number }): Promise<CursorPage<CommentDto>> {
  await loadVisiblePost(ctx, tenantCtx, actor, postId);
  const { isAdmin } = viewerFlags(actor, "");
  const page = await listComments(ctx.db, tenantCtx.tenant.id, postId, query, isAdmin);
  return { data: page.data.map((r) => toCommentDto(r.comment, r.author, actor.membership.id)), nextCursor: page.nextCursor };
}

export async function addComment(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, postId: string, input: CommentCreateInput): Promise<CommentDto> {
  const found = await loadVisiblePost(ctx, tenantCtx, actor, postId);
  if (found.post.moderationStatus !== "APPROVED") throw AppError.forbidden("You can only comment on published posts");
  const row = await insertComment(ctx.db, {
    tenantId: tenantCtx.tenant.id,
    postId,
    authorMembershipId: actor.membership.id,
    body: input.body,
    moderationStatus: "APPROVED",
    moderatedAt: new Date(),
  });
  await adjustCommentCount(ctx.db, postId, 1);
  if (found.post.authorMembershipId !== actor.membership.id) {
    await notify(ctx, {
      tenantId: tenantCtx.tenant.id,
      recipientMembershipIds: [found.post.authorMembershipId],
      type: "POST_COMMENT",
      title: `${actor.membership.fullName} commented on your post`,
      body: input.body.slice(0, 120),
      data: { postId, commentId: row.id, contentType: "POST", contentId: postId },
    });
  }
  return toCommentDto(row, actor.membership, actor.membership.id);
}

export async function getCommentForAdmin(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<CommentDto> {
  const found = await findCommentWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Comment not found");
  return toCommentDto(found.comment, found.author, actor.membership.id);
}

export async function removeComment(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, postId: string, commentId: string): Promise<void> {
  const found = await findCommentWithAuthor(ctx.db, tenantCtx.tenant.id, commentId);
  if (!found || found.comment.postId !== postId) throw AppError.notFound("Comment not found");
  assertAuthorOrAdmin(actor, found.comment.authorMembershipId);
  await deleteComment(ctx.db, tenantCtx.tenant.id, commentId);
  if (found.comment.moderationStatus === "APPROVED") await adjustCommentCount(ctx.db, postId, -1);
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "COMMENT", id: commentId, title: found.comment.body, status: found.comment.moderationStatus, action: "delete" });
}

// ---- reactions ----

export async function setReaction(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, postId: string, type: ReactionType): Promise<ReactionSummaryDto> {
  const found = await loadVisiblePost(ctx, tenantCtx, actor, postId);
  if (found.post.moderationStatus !== "APPROVED") throw AppError.forbidden("You can only react to published posts");
  const existing = await findReaction(ctx.db, postId, actor.membership.id);
  await upsertReaction(ctx.db, { tenantId: tenantCtx.tenant.id, postId, membershipId: actor.membership.id, type });
  const reactionCount = await recountReactions(ctx.db, postId);
  if (!existing && found.post.authorMembershipId !== actor.membership.id) {
    await notify(ctx, {
      tenantId: tenantCtx.tenant.id,
      recipientMembershipIds: [found.post.authorMembershipId],
      type: "POST_REACTION",
      title: `${actor.membership.fullName} reacted to your post`,
      body: found.post.body.slice(0, 120),
      data: { postId, contentType: "POST", contentId: postId, reaction: type },
    });
  }
  return { reactionCount, myReaction: type };
}

export async function clearReaction(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, postId: string): Promise<ReactionSummaryDto> {
  await loadVisiblePost(ctx, tenantCtx, actor, postId);
  await deleteReaction(ctx.db, postId, actor.membership.id);
  const reactionCount = await recountReactions(ctx.db, postId);
  return { reactionCount, myReaction: null };
}

export async function listPostReactions(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, postId: string, query: { cursor?: string; limit: number; type?: ReactionType }): Promise<CursorPage<ReactionEntryDto>> {
  await loadVisiblePost(ctx, tenantCtx, actor, postId);
  const page = await listReactions(ctx.db, postId, query);
  return { data: page.data.map((r) => toReactionEntryDto(r.reaction, r.member)), nextCursor: page.nextCursor };
}
