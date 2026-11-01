import { commentCreateSchema, commentParamsSchema, cursorQuerySchema, idParamsSchema, pollVoteSchema, postCreateSchema, postListQuerySchema, postUpdateSchema, reactionListQuerySchema, reactionSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { byMembership, rateLimit } from "../../middleware/rateLimit";
import { requireFeature, requireMember } from "../../middleware/tenant";
import { noContent, ok, route } from "../../middleware/validate";
import {
  addComment,
  clearReaction,
  createPost,
  getPost,
  listPostComments,
  listPostReactions,
  listTenantPosts,
  removeComment,
  removePost,
  setReaction,
  updatePostBody,
  votePoll,
} from "../../services/posts.service";
import { contentActor } from "./_actor";

export function postRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/posts", requireMember, requireFeature("feed"));
  const createLimit = rateLimit(ctx, { bucket: "content-create", limit: 30, windowSec: 3600, keyFn: byMembership });
  const commentLimit = rateLimit(ctx, { bucket: "comment-create", limit: 120, windowSec: 3600, keyFn: byMembership });

  router.get("/posts", route({ query: postListQuerySchema }, async ({ req, res, query }) => res.json(await listTenantPosts(ctx, req.tenantCtx!, contentActor(req), query))));
  router.post("/posts", createLimit, route({ body: postCreateSchema }, async ({ req, res, body }) => ok(res, await createPost(ctx, req.tenantCtx!, contentActor(req), body), 201)));
  router.get("/posts/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await getPost(ctx, req.tenantCtx!, contentActor(req), params.id))));
  router.patch("/posts/:id", route({ params: idParamsSchema, body: postUpdateSchema }, async ({ req, res, params, body }) => ok(res, await updatePostBody(ctx, req.tenantCtx!, contentActor(req), params.id, body))));
  router.delete("/posts/:id", route({ params: idParamsSchema }, async ({ req, res, params }) => {
    await removePost(ctx, req.tenantCtx!, contentActor(req), params.id);
    noContent(res);
  }));

  router.get("/posts/:id/comments", route({ params: idParamsSchema, query: cursorQuerySchema }, async ({ req, res, params, query }) => res.json(await listPostComments(ctx, req.tenantCtx!, contentActor(req), params.id, query))));
  router.post("/posts/:id/comments", commentLimit, route({ params: idParamsSchema, body: commentCreateSchema }, async ({ req, res, params, body }) => ok(res, await addComment(ctx, req.tenantCtx!, contentActor(req), params.id, body), 201)));
  router.delete("/posts/:id/comments/:commentId", route({ params: commentParamsSchema }, async ({ req, res, params }) => {
    await removeComment(ctx, req.tenantCtx!, contentActor(req), params.id, params.commentId);
    noContent(res);
  }));

  const voteLimit = rateLimit(ctx, { bucket: "poll-vote", limit: 120, windowSec: 3600, keyFn: byMembership });
  router.put("/posts/:id/poll/vote", voteLimit, route({ params: idParamsSchema, body: pollVoteSchema }, async ({ req, res, params, body }) => ok(res, await votePoll(ctx, req.tenantCtx!, contentActor(req), params.id, body.optionIds))));
  router.delete("/posts/:id/poll/vote", voteLimit, route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await votePoll(ctx, req.tenantCtx!, contentActor(req), params.id, null))));
  router.get("/posts/:id/reactions", route({ params: idParamsSchema, query: reactionListQuerySchema }, async ({ req, res, params, query }) => res.json(await listPostReactions(ctx, req.tenantCtx!, contentActor(req), params.id, query))));
  router.put("/posts/:id/reactions", route({ params: idParamsSchema, body: reactionSchema }, async ({ req, res, params, body }) => ok(res, await setReaction(ctx, req.tenantCtx!, contentActor(req), params.id, body.type))));
  router.delete("/posts/:id/reactions", route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await clearReaction(ctx, req.tenantCtx!, contentActor(req), params.id))));
  return router;
}
