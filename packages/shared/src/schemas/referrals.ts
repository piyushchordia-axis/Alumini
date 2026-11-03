import { z } from "zod";
import { REFERRAL_BOXES, REFERRAL_NOTE_MAX_LENGTH, REFERRAL_NOTE_MIN_LENGTH } from "../constants";
import { stripControlCharacters, VISIBLE_CHARACTER } from "./chat";
import { cursorQuerySchema } from "./common";

/** The poster reads it, and it becomes the chat's first message if they accept, so it follows a message's rules too. */
export const referralNoteSchema = z
  .string()
  .transform(stripControlCharacters)
  .pipe(
    z
      .string()
      .min(REFERRAL_NOTE_MIN_LENGTH, `Write at least ${REFERRAL_NOTE_MIN_LENGTH} characters`)
      .max(REFERRAL_NOTE_MAX_LENGTH, `Keep it to ${REFERRAL_NOTE_MAX_LENGTH} characters`)
      .regex(VISIBLE_CHARACTER, "Write a note to the poster"),
  );

export const referralRequestCreateSchema = z.object({ note: referralNoteSchema });
export type ReferralRequestCreateInput = z.input<typeof referralRequestCreateSchema>;

/** A member's own requests: received, about their jobs, or sent. */
export const referralRequestsQuerySchema = cursorQuerySchema.extend({ box: z.enum(REFERRAL_BOXES).default("received") });
export type ReferralRequestsQuery = z.infer<typeof referralRequestsQuerySchema>;
