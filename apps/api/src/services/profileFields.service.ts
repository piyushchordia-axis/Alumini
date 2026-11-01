import {
  MAX_PROFILE_FIELDS,
  formatProfileFieldValue,
  profileFieldConsistencyIssues,
  validateProfileFieldValue,
  validateProfileFieldValues,
  type ProfileFieldAnswerDto,
  type ProfileFieldCreateInput,
  type ProfileFieldDto,
  type ProfileFieldUpdateInput,
  type ProfileFieldValue,
} from "@illuminize/shared";
import type { AppContext } from "../context";
import type { DbClient } from "../db/client";
import { AppError } from "../lib/errors";
import { runInTransaction } from "../lib/transaction";
import { keys } from "../redis/keys";
import {
  countActiveProfileFields,
  deleteAnswers,
  fieldHasAnswers,
  findProfileField,
  insertProfileField,
  listAnswers,
  listProfileFields,
  nextProfileFieldPosition,
  updateProfileField,
  upsertAnswers,
  type ProfileFieldRow,
} from "../repositories/profileFields.repo";
import type { AuthContext } from "../types/request";
import { recordAudit } from "./audit.service";

interface AdminActor extends AuthContext {
  membershipId?: string | null;
  ip?: string;
}

const FIELDS_TTL_SEC = 300;

export function toProfileFieldDto(f: ProfileFieldRow): ProfileFieldDto {
  return {
    id: f.id,
    key: f.key,
    label: f.label,
    helpText: f.helpText,
    type: f.type,
    options: f.options,
    required: f.required,
    visibility: f.visibility,
    memberEditable: f.memberEditable,
    filterable: f.filterable,
    position: f.position,
    archivedAt: f.archivedAt ? f.archivedAt.toISOString() : null,
  };
}

/** The institution's active fields, in order (cached briefly; admin changes clear the cache). */
export async function getActiveFields(ctx: AppContext, tenantId: string): Promise<ProfileFieldDto[]> {
  const key = keys.cacheProfileFields(tenantId);
  const cached = await ctx.redis.get(key);
  if (cached) return JSON.parse(cached) as ProfileFieldDto[];
  const fields = (await listProfileFields(ctx.db, tenantId)).map(toProfileFieldDto);
  await ctx.redis.set(key, JSON.stringify(fields), "EX", FIELDS_TTL_SEC);
  return fields;
}

async function invalidateFields(ctx: AppContext, tenantId: string): Promise<void> {
  await ctx.redis.del(keys.cacheProfileFields(tenantId), keys.cacheDirectoryFilters(tenantId));
}

/**
 * Who is looking at a profile: "public" (other members) sees members-visible answers; "self" also sees admin-only
 * questions the member answers; "admin" sees everything, including admin-managed notes hidden from the member.
 */
export type FieldAudience = "public" | "self" | "admin";

export function fieldVisibleTo(f: Pick<ProfileFieldDto, "visibility" | "memberEditable">, audience: FieldAudience): boolean {
  if (audience === "admin") return true;
  if (audience === "public") return f.visibility === "MEMBERS";
  return f.visibility === "MEMBERS" || f.memberEditable;
}

/** Fields a member's own form shows (registration and profile editing). */
export async function getFieldsForMember(ctx: AppContext, tenantId: string): Promise<ProfileFieldDto[]> {
  return (await getActiveFields(ctx, tenantId)).filter((f) => fieldVisibleTo(f, "self"));
}

/** Answers for several members as one audience sees them, in field order (unanswered fields omitted). */
export async function answersFor(ctx: AppContext, tenantId: string, membershipIds: string[], audience: FieldAudience, db: DbClient = ctx.db): Promise<Map<string, ProfileFieldAnswerDto[]>> {
  const out = new Map<string, ProfileFieldAnswerDto[]>(membershipIds.map((id) => [id, []]));
  const fields = (await getActiveFields(ctx, tenantId)).filter((f) => fieldVisibleTo(f, audience));
  if (fields.length === 0 || membershipIds.length === 0) return out;
  const byId = new Map(fields.map((f, i) => [f.id, { f, i }]));
  const rows = await listAnswers(db, membershipIds);
  for (const r of rows) {
    const hit = byId.get(r.fieldId);
    if (!hit) continue;
    out.get(r.membershipId)?.push({ key: hit.f.key, label: hit.f.label, type: hit.f.type, visibility: hit.f.visibility, value: r.value, display: formatProfileFieldValue(hit.f, r.value) });
  }
  const order = new Map(fields.map((f, i) => [f.key, i]));
  for (const list of out.values()) list.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
  return out;
}

export async function answersForOne(ctx: AppContext, tenantId: string, membershipId: string, audience: FieldAudience, db: DbClient = ctx.db): Promise<ProfileFieldAnswerDto[]> {
  return (await answersFor(ctx, tenantId, [membershipId], audience, db)).get(membershipId) ?? [];
}

/**
 * Validates and stores a member's answers. register: every required field the member answers must be present.
 * member: only member-editable fields; clearing a required answer is refused. admin: any field. Errors carry
 * `fields.<key>` paths so forms can show them next to the inputs.
 */
export async function saveAnswers(
  ctx: AppContext,
  db: DbClient,
  tenantId: string,
  membershipId: string,
  input: Record<string, unknown> | undefined,
  mode: "register" | "member" | "admin",
): Promise<void> {
  const fields = await getActiveFields(ctx, tenantId);
  if (fields.length === 0 && (!input || Object.keys(input).length === 0)) return;
  const current = await listAnswers(db, [membershipId]);
  const keyById = new Map(fields.map((f) => [f.id, f.key]));
  const previous: Record<string, ProfileFieldValue> = {};
  for (const r of current) {
    const k = keyById.get(r.fieldId);
    if (k) previous[k] = r.value;
  }
  // Members can't see admin-managed hidden fields, so those don't exist for them.
  const visible = mode === "admin" ? fields : fields.filter((f) => fieldVisibleTo(f, "self"));
  const { values, errors } = validateProfileFieldValues(visible, input, {
    requireAll: mode === "register",
    previous,
    canEdit: mode === "admin" ? undefined : (f) => f.memberEditable,
  });
  if (Object.keys(errors).length) {
    throw AppError.badRequest(
      "Please check your answers",
      Object.entries(errors).map(([key, message]) => ({ path: `fields.${key}`, message })),
    );
  }
  const idByKey = new Map(fields.map((f) => [f.key, f.id]));
  const set: Array<{ tenantId: string; membershipId: string; fieldId: string; value: ProfileFieldValue }> = [];
  const clear: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const fieldId = idByKey.get(key)!;
    if (value === null) clear.push(fieldId);
    else set.push({ tenantId, membershipId, fieldId, value });
  }
  await upsertAnswers(db, set);
  await deleteAnswers(db, membershipId, clear);
}

/**
 * Applies answers an admin imported with an invitation, when the member accepts it: only valid answers to active
 * fields, and never over an answer the member just gave. Invalid or stale ones are skipped, not errors.
 */
export async function applyInvitationAnswers(ctx: AppContext, db: DbClient, tenantId: string, membershipId: string, prefill: Record<string, ProfileFieldValue>, answeredKeys: string[]): Promise<void> {
  const fields = await getActiveFields(ctx, tenantId);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const rows: Array<{ tenantId: string; membershipId: string; fieldId: string; value: ProfileFieldValue }> = [];
  for (const [key, raw] of Object.entries(prefill)) {
    const def = byKey.get(key);
    if (!def || answeredKeys.includes(key)) continue;
    const r = validateProfileFieldValue(def, raw);
    if (r.ok && r.value !== null) rows.push({ tenantId, membershipId, fieldId: def.id, value: r.value });
  }
  await upsertAnswers(db, rows);
}

// --- Admin -------------------------------------------------------------------------------------------------------

export async function listFieldsForAdmin(ctx: AppContext, tenantId: string, includeArchived: boolean): Promise<ProfileFieldDto[]> {
  return (await listProfileFields(ctx.db, tenantId, { includeArchived })).map(toProfileFieldDto);
}

function assertConsistent(v: { type: ProfileFieldRow["type"]; options: Array<{ value: string }>; filterable: boolean }) {
  const issues = profileFieldConsistencyIssues(v);
  if (issues.length) throw AppError.badRequest(issues[0]!.message, issues);
}

export async function createProfileField(ctx: AppContext, tenantId: string, actor: AdminActor, input: ProfileFieldCreateInput): Promise<ProfileFieldDto> {
  if ((await countActiveProfileFields(ctx.db, tenantId)) >= MAX_PROFILE_FIELDS) {
    throw AppError.conflict(`An institution can have at most ${MAX_PROFILE_FIELDS} active profile fields. Archive one first.`);
  }
  const row = await insertProfileField(ctx.db, {
    tenantId,
    key: input.key,
    label: input.label,
    helpText: input.helpText ?? null,
    type: input.type,
    options: input.options,
    required: input.required,
    visibility: input.visibility,
    memberEditable: input.memberEditable,
    filterable: input.filterable,
    position: await nextProfileFieldPosition(ctx.db, tenantId),
  });
  if (!row) throw AppError.conflict(`A field with the key "${input.key}" already exists`, "CONFLICT", [{ path: "key", message: "Already used by another field" }]);
  await invalidateFields(ctx, tenantId);
  await recordAudit(ctx, { tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId ?? null, action: "profile_field.create", targetType: "profile_field", targetId: row.id, metadata: { key: row.key, type: row.type }, ip: actor.ip });
  return toProfileFieldDto(row);
}

export async function updateProfileFieldDef(ctx: AppContext, tenantId: string, actor: AdminActor, id: string, input: ProfileFieldUpdateInput): Promise<ProfileFieldDto> {
  const field = await findProfileField(ctx.db, tenantId, id);
  if (!field) throw AppError.notFound("Profile field not found");
  const merged = { ...field, ...input };
  assertConsistent(merged);
  if (input.type && input.type !== field.type && (await fieldHasAnswers(ctx.db, id))) {
    throw AppError.conflict("Members have already answered this field, so its type can't change. Archive it and add a new one.", "CONFLICT", [{ path: "type", message: "Can't change once answered" }]);
  }
  const row = (await updateProfileField(ctx.db, tenantId, id, {
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.helpText !== undefined ? { helpText: input.helpText } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.options !== undefined ? { options: input.options } : {}),
    ...(input.required !== undefined ? { required: input.required } : {}),
    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    ...(input.memberEditable !== undefined ? { memberEditable: input.memberEditable } : {}),
    ...(input.filterable !== undefined ? { filterable: input.filterable } : {}),
  }))!;
  await invalidateFields(ctx, tenantId);
  await recordAudit(ctx, { tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId ?? null, action: "profile_field.update", targetType: "profile_field", targetId: id, metadata: { fields: Object.keys(input) }, ip: actor.ip });
  return toProfileFieldDto(row);
}

export async function reorderProfileFields(ctx: AppContext, tenantId: string, actor: AdminActor, ids: string[]): Promise<ProfileFieldDto[]> {
  const fields = await listProfileFields(ctx.db, tenantId, { includeArchived: true });
  const known = new Set(fields.map((f) => f.id));
  if (ids.some((id) => !known.has(id))) throw AppError.badRequest("Unknown field in the new order");
  await runInTransaction(ctx, async (tx) => {
    // Listed fields first, in the given order; any others keep their relative order after them.
    const rest = fields.filter((f) => !ids.includes(f.id)).map((f) => f.id);
    for (const [i, id] of [...ids, ...rest].entries()) await updateProfileField(tx, tenantId, id, { position: i + 1 });
  });
  await invalidateFields(ctx, tenantId);
  await recordAudit(ctx, { tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId ?? null, action: "profile_field.reorder", ip: actor.ip });
  return listFieldsForAdmin(ctx, tenantId, true);
}

export async function setProfileFieldArchived(ctx: AppContext, tenantId: string, actor: AdminActor, id: string, archived: boolean): Promise<ProfileFieldDto> {
  const field = await findProfileField(ctx.db, tenantId, id);
  if (!field) throw AppError.notFound("Profile field not found");
  if (!archived && field.archivedAt && (await countActiveProfileFields(ctx.db, tenantId)) >= MAX_PROFILE_FIELDS) {
    throw AppError.conflict(`An institution can have at most ${MAX_PROFILE_FIELDS} active profile fields. Archive another one first.`);
  }
  const row = (await updateProfileField(ctx.db, tenantId, id, { archivedAt: archived ? (field.archivedAt ?? new Date()) : null }))!;
  await invalidateFields(ctx, tenantId);
  await recordAudit(ctx, { tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId ?? null, action: archived ? "profile_field.archive" : "profile_field.restore", targetType: "profile_field", targetId: id, metadata: { key: field.key }, ip: actor.ip });
  return toProfileFieldDto(row);
}
