import { NOTIFICATION_CATEGORY, notificationLevelFor, uuidSchema, type NotificationDto, type NotificationSubjectDto, type NotificationType, type NotificationsQuery } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient, Tx } from "../../db/client";
import { toNotificationDto } from "../../dto/membership.dto";
import type { CursorPage } from "../../lib/pagination";
import { afterCommit } from "../../lib/transaction";
import { rooms } from "../../realtime/rooms";
import { findMembershipsByIds, listTenantAdmins } from "../../repositories/memberships.repo";
import {
  countUnreadByMemberships,
  findNotificationPrefsByMemberships,
  insertNotifications,
  listNotifications,
  markUnreadReadByData,
  upsertMergedNotifications,
  type NotificationInsert,
  type NotificationRow,
} from "../../repositories/notifications.repo";

export interface NotifyInput {
  tenantId: string;
  recipientMembershipIds: string[];
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Ids only (it travels in push payloads, which are capped at 4 KB). */
  data?: Record<string, unknown>;
  /** Makes the notification idempotent per recipient: a repeat (a retried job) adds nothing. */
  dedupeKey?: string;
  /**
   * With dedupeKey: a repeat updates the existing notification (text, data, unread again, moved to the top) instead
   * of being skipped. Updated notifications reach open apps but are not pushed again.
   */
  merge?: boolean;
  /** Sent to many members at once (announcements): open apps get one broadcast instead of a message each. */
  bulk?: boolean;
}

/** Rows per INSERT, well under Postgres's 65,535 bind parameters. */
const INSERT_CHUNK = 1000;
/** Max notification ids per dispatch job (keeps job payloads small). */
const DISPATCH_CHUNK = 500;

/**
 * Stores in-app notifications for the recipients whose preferences allow them, then queues delivery to devices once
 * the data is committed. Works with the root handle or a runInTransaction() transaction (delivery is dropped if it
 * rolls back). The stored rows are the source of truth: if queueing fails, members still see them in the app.
 */
export async function notify(ctx: AppContext, input: NotifyInput, db: DbClient = ctx.db): Promise<void> {
  const all = [...new Set(input.recipientMembershipIds)];
  const alwaysDelivered = NOTIFICATION_CATEGORY[input.type] === "ACCOUNT";
  const toDispatch: string[] = [];
  const toRefresh: string[] = [];
  for (let i = 0; i < all.length; i += INSERT_CHUNK) {
    let ids = all.slice(i, i + INSERT_CHUNK);
    if (!alwaysDelivered) {
      const prefs = await findNotificationPrefsByMemberships(db, ids);
      ids = ids.filter((id) => notificationLevelFor(input.type, prefs.get(id)) !== "OFF");
    }
    const values: NotificationInsert[] = ids.map((recipientMembershipId) => ({
      tenantId: input.tenantId,
      recipientMembershipId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: input.data ?? {},
      dedupeKey: input.dedupeKey ?? null,
    }));
    if (input.merge && input.dedupeKey) {
      for (const row of await upsertMergedNotifications(db, values)) (row.inserted ? toDispatch : toRefresh).push(row.id);
    } else {
      for (const row of await insertNotifications(db, values)) toDispatch.push(row.id);
    }
  }
  const enqueue = (notificationIds: string[], extra: { bulk?: boolean; push?: boolean }) =>
    afterCommit(ctx, db, () => ctx.jobs.enqueue("notifications.dispatch", { tenantId: input.tenantId, notificationIds, ...extra }));
  for (let i = 0; i < toDispatch.length; i += DISPATCH_CHUNK) await enqueue(toDispatch.slice(i, i + DISPATCH_CHUNK), input.bulk ? { bulk: true } : {});
  for (let i = 0; i < toRefresh.length; i += DISPATCH_CHUNK) await enqueue(toRefresh.slice(i, i + DISPATCH_CHUNK), { push: false });
}

export async function notifyTenantAdmins(
  ctx: AppContext,
  /** excludeStaff leaves out Illuminize staff holding the admin role, for what only the institution's own admins handle. */
  input: Omit<NotifyInput, "recipientMembershipIds"> & { excludeMembershipId?: string; excludeMembershipIds?: Array<string | null>; excludeStaff?: boolean },
  db: DbClient = ctx.db,
): Promise<void> {
  const admins = await listTenantAdmins(db, input.tenantId, { excludeStaff: input.excludeStaff });
  const excluded = new Set([input.excludeMembershipId, ...(input.excludeMembershipIds ?? [])]);
  const recipientMembershipIds = admins.map((a) => a.id).filter((id) => !excluded.has(id));
  await notify(ctx, { ...input, recipientMembershipIds }, db);
}

/** Who reads a notification list: admins also get each new-member notice's request as it stands now. */
export interface NotificationViewer {
  tenantId: string;
  membershipId: string;
  isAdmin: boolean;
}

/** The viewer's notifications, newest first. */
export async function listNotificationsForViewer(ctx: AppContext, viewer: NotificationViewer, query: NotificationsQuery): Promise<CursorPage<NotificationDto>> {
  const page = await listNotifications(ctx.db, viewer.membershipId, query);
  const subjects = viewer.isAdmin ? await memberRequestSubjects(ctx, viewer.tenantId, page.data) : new Map<string, NotificationSubjectDto>();
  return { data: page.data.map((row) => toNotificationDto(row, subjects.get(row.id))), nextCursor: page.nextCursor };
}

/** The membership each NEW_MEMBER_PENDING row asks about, by notification id, read in one query for the page. */
async function memberRequestSubjects(ctx: AppContext, tenantId: string, rows: NotificationRow[]): Promise<Map<string, NotificationSubjectDto>> {
  const asked = new Map<string, string>();
  for (const row of rows) {
    const id = row.type === "NEW_MEMBER_PENDING" ? uuidSchema.safeParse(row.data.membershipId) : null;
    if (id?.success) asked.set(row.id, id.data);
  }
  if (asked.size === 0) return new Map();
  const found = new Map((await findMembershipsByIds(ctx.db, tenantId, [...new Set(asked.values())])).map((m) => [m.id, m]));
  return new Map(
    [...asked].map(([notificationId, membershipId]) => {
      const m = found.get(membershipId);
      return [notificationId, { kind: "membership", membershipId, fullName: m?.fullName ?? null, status: m?.status ?? null }];
    }),
  );
}

/**
 * Marks read every current admin's copy of the `type` notices about these memberships, staff holding the admin role
 * included (they get NEW_MEMBER_PENDING too), once one admin has dealt with them, so nobody else is asked to. Inside the
 * transaction of the change, in one statement however many there are (approving everyone waiting can handle thousands);
 * open apps get the new unread counts once it commits.
 */
export async function markAdminNoticesHandled(ctx: AppContext, tx: Tx, input: { tenantId: string; tenantSlug: string; type: NotificationType; ids: string[] }): Promise<void> {
  if (input.ids.length === 0) return;
  const admins = await listTenantAdmins(tx, input.tenantId);
  const marked = new Set(await markUnreadReadByData(tx, admins.map((a) => a.id), input.type, "membershipId", input.ids));
  const affected = admins.filter((a) => marked.has(a.id));
  if (affected.length === 0) return;
  await afterCommit(ctx, tx, async () => {
    const unread = await countUnreadByMemberships(ctx.db, affected.map((a) => a.id));
    for (const a of affected) ctx.realtime.emit(rooms.user(a.userId), "notification:unread", { tenantSlug: input.tenantSlug, membershipId: a.id, count: unread.get(a.id) ?? 0 });
  });
}
