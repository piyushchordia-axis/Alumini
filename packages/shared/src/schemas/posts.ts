import { z } from "zod";
import { MAX_POST_IMAGES, REACTION_TYPES } from "../constants";
import { booleanQuerySchema, cursorQuerySchema, httpUrlSchema, trimmedString, uuidSchema } from "./common";

export const postCreateSchema = z.object({
  body: trimmedString(5000, 1),
  imageUrls: z.array(httpUrlSchema).max(MAX_POST_IMAGES).optional(),
});
export type PostCreateInput = z.infer<typeof postCreateSchema>;

export const postUpdateSchema = postCreateSchema.partial();
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;

export const postListQuerySchema = cursorQuerySchema.extend({
  mine: booleanQuerySchema.optional(),
});
export type PostListQuery = z.infer<typeof postListQuerySchema>;

export const commentCreateSchema = z.object({
  body: trimmedString(2000, 1),
});
export type CommentCreateInput = z.infer<typeof commentCreateSchema>;

export const reactionSchema = z.object({
  type: z.enum(REACTION_TYPES),
});
export type ReactionInput = z.infer<typeof reactionSchema>;

export const reactionListQuerySchema = cursorQuerySchema.extend({
  type: z.enum(REACTION_TYPES).optional(),
});

export const commentParamsSchema = z.object({ id: uuidSchema, commentId: uuidSchema });
