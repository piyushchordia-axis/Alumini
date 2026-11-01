import { z } from "zod";
import { MAX_POLL_OPTIONS, MAX_POST_IMAGES, REACTION_TYPES } from "../constants";
import { booleanQuerySchema, cursorQuerySchema, httpUrlSchema, isoDateTimeSchema, trimmedString, uuidSchema } from "./common";

/** A poll on a post: the post's text is the question. Polls can't be edited once posted. */
export const pollCreateSchema = z.object({
  options: z
    .array(trimmedString(80, 1))
    .min(2, "Add at least two options")
    .max(MAX_POLL_OPTIONS, `At most ${MAX_POLL_OPTIONS} options`)
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, "Options must be different"),
  allowsMultiple: z.boolean().default(false),
  closesAt: isoDateTimeSchema
    .nullable()
    .optional()
    .refine((v) => !v || new Date(v).getTime() > Date.now(), "Closing time must be in the future"),
});
export type PollCreateInput = z.infer<typeof pollCreateSchema>;

const postFields = {
  body: trimmedString(5000, 1),
  imageUrls: z.array(httpUrlSchema).max(MAX_POST_IMAGES).optional(),
};

export const postCreateSchema = z.object({
  ...postFields,
  poll: pollCreateSchema.optional(),
});
export type PostCreateInput = z.infer<typeof postCreateSchema>;

/** Only the text and images can change; a poll stays as posted. */
export const postUpdateSchema = z.object(postFields).partial();
export type PostUpdateInput = z.infer<typeof postUpdateSchema>;

export const pollVoteSchema = z.object({ optionIds: z.array(uuidSchema).min(1).max(MAX_POLL_OPTIONS) });
export type PollVoteInput = z.infer<typeof pollVoteSchema>;

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
