import { z } from "zod";
import {
  MENTOR_AREAS,
  MENTOR_AVAILABILITIES,
  MENTOR_AVAILABILITY_NOTE_MAX_LENGTH,
  MENTOR_MAX_AREAS,
  MENTOR_NOTE_MAX_LENGTH,
  MENTORSHIP_BOXES,
  MENTORSHIP_NOTE_MAX_LENGTH,
  MENTORSHIP_NOTE_MIN_LENGTH,
} from "../constants";
import { stripControlCharacters, VISIBLE_CHARACTER } from "./chat";
import { cursorQuerySchema, uuidSchema } from "./common";

/** Optional free text on a mentor's profile, cleaned like chat text. Empty, or nothing visible, clears it. */
const optionalProfileText = (max: number) =>
  z
    .string()
    .transform(stripControlCharacters)
    .pipe(z.string().max(max))
    .transform((v) => (VISIBLE_CHARACTER.test(v) ? v : null))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const mentorProfileUpsertSchema = z.object({
  areas: z
    .array(z.enum(MENTOR_AREAS, { error: "Choose areas from the list" }))
    .transform((areas) => [...new Set(areas)])
    .pipe(z.array(z.enum(MENTOR_AREAS)).min(1, "Choose at least one area").max(MENTOR_MAX_AREAS, `Choose up to ${MENTOR_MAX_AREAS} areas`)),
  availability: z.enum(MENTOR_AVAILABILITIES, { error: "Choose how often you can meet" }),
  availabilityNote: optionalProfileText(MENTOR_AVAILABILITY_NOTE_MAX_LENGTH),
  note: optionalProfileText(MENTOR_NOTE_MAX_LENGTH),
});
export type MentorProfileUpsertInput = z.input<typeof mentorProfileUpsertSchema>;
export type MentorProfileUpsert = z.output<typeof mentorProfileUpsertSchema>;

export const mentorsQuerySchema = cursorQuerySchema.extend({
  /** A name, or part of one. */
  q: z.string().trim().max(80).optional(),
  area: z.enum(MENTOR_AREAS).optional(),
  availability: z.enum(MENTOR_AVAILABILITIES).optional(),
});
export type MentorsQuery = z.infer<typeof mentorsQuerySchema>;

/** The mentor reads it, and it becomes the chat's first message if they accept, so it follows a message's rules too. */
export const mentorshipNoteSchema = z
  .string()
  .transform(stripControlCharacters)
  .pipe(
    z
      .string()
      .min(MENTORSHIP_NOTE_MIN_LENGTH, `Write at least ${MENTORSHIP_NOTE_MIN_LENGTH} characters`)
      .max(MENTORSHIP_NOTE_MAX_LENGTH, `Keep it to ${MENTORSHIP_NOTE_MAX_LENGTH} characters`)
      .regex(VISIBLE_CHARACTER, "Write a note to the mentor"),
  );

export const mentorshipRequestCreateSchema = z.object({ mentorMembershipId: uuidSchema, note: mentorshipNoteSchema });
export type MentorshipRequestCreateInput = z.input<typeof mentorshipRequestCreateSchema>;

export const mentorshipRequestsQuerySchema = cursorQuerySchema.extend({ box: z.enum(MENTORSHIP_BOXES).default("received") });
export type MentorshipRequestsQuery = z.infer<typeof mentorshipRequestsQuerySchema>;
