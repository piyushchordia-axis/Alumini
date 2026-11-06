import type { ReportStatus } from "@illuminize/shared";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbClient, Tx } from "../db/client";
import { chatMessages, chatReports, memberships, tenants, users } from "../db/schema";
import { senderColumns, type ChatSender, type MessageWithSender } from "./chat.repo";
import type { UserRow } from "./users.repo";

export type ChatReportRow = typeof chatReports.$inferSelect;
export type ChatReportInsert = typeof chatReports.$inferInsert;

/** Undefined when this reporter already reported this message. */
export async function insertChatReport(db: DbClient, values: ChatReportInsert): Promise<ChatReportRow | undefined> {
  const [row] = await db.insert(chatReports).values(values).onConflictDoNothing().returning();
  return row;
}

// These read the chat_reports row of the query around them, spelled out: in a single-table select Drizzle drops the table
// name from an interpolated column, and an unqualified tenant_id would then mean the memberships one and always match.

/**
 * Whether the report names any membership of this user (an id, or a column of the query around it), as its reporter or as
 * its reported member.
 */
export const reportNamesUser = (userId: string | SQL): SQL => sql`exists (select 1 from memberships m where m.user_id = ${userId} and m.id in (chat_reports.reporter_membership_id, chat_reports.reported_membership_id))`;

const reportedIsAdmin: SQL = sql`exists (select 1 from memberships m where m.id = chat_reports.reported_membership_id and m.role = 'TENANT_ADMIN' and m.status = 'APPROVED')`;

/**
 * No admin is left whom the report doesn't name. Illuminize staff holding the admin role don't count: they reach only what's
 * escalated, so a report left with them alone would otherwise reach nobody.
 */
const noEligibleAdmin: SQL = sql`not exists (select 1 from memberships m join users u on u.id = m.user_id where m.tenant_id = chat_reports.tenant_id and m.role = 'TENANT_ADMIN' and m.status = 'APPROVED' and not u.is_platform_admin and m.id is distinct from chat_reports.reporter_membership_id and m.id is distinct from chat_reports.reported_membership_id)`;

/** Whether the report is for Illuminize staff, worked out on each read so that it follows who is an admin today. */
const reportIsEscalated: SQL = sql`(${reportedIsAdmin} or ${noEligibleAdmin})`;

/**
 * A status change's target held the admin role then, as the row records (`role`), or, on a row written before it was
 * recorded, holds it now.
 */
const changedAnAdmin: SQL = sql`case when a.metadata->'role' is not null then a.metadata->>'role' = 'TENANT_ADMIN' else exists (select 1 from memberships m where m.id = a.target_id and m.role = 'TENANT_ADMIN') end`;

/** A staff flag change's target was an admin of the report's institution then (`adminOf`), or, on an older row, is now. */
const flaggedAnAdminThere: SQL = sql`case when a.metadata->'adminOf' is not null then a.metadata->'adminOf' @> jsonb_build_array(chat_reports.tenant_id::text) else exists (select 1 from memberships m where m.user_id = a.target_id and m.tenant_id = chat_reports.tenant_id and m.role = 'TENANT_ADMIN') end`;

/**
 * Whether this user (an id, or a column of the query around it) changed who is an admin of the report's institution
 * after it was filed, which can be what made it staff's: assigning or removing an admin, changing a role, approving,
 * suspending or reinstating an admin, or turning the staff flag of one of its admins on or off. Read from the audit rows
 * these changes write in their own transaction (recordAuditStrict), so none can happen unrecorded; a new way to change
 * the admins needs its action here.
 *
 * Left out are changes that can't make a report staff's, so staff can act on what it's about and still close it: any to
 * its reporter, whom neither reason for escalating reads, and taking the admin role from its reported member (suspending
 * them, removing or demoting them), which can only end "About an admin". Giving it back (reinstating, assigning,
 * promoting) still counts. An approval counts only where the row records an admin's, which the apps never leave waiting.
 *
 * Both timestamps are when their transaction began, not when it committed, so a change that began just before the report
 * and committed after it carries the earlier time: one up to a minute before the report counts too. There's no upper
 * bound, as escalation is worked out on each read, so a later change can make even a closed report staff's to view.
 */
const rosterChangedBy = (userId: string | SQL): SQL =>
  sql`exists (select 1 from audit_log a where a.actor_user_id = ${userId} and a.created_at >= chat_reports.created_at - interval '1 minute' and (
    (a.tenant_id = chat_reports.tenant_id and a.target_id is distinct from chat_reports.reporter_membership_id and (
      a.action = 'platform.tenant.admin.assign'
      or (a.action = 'platform.tenant.admin.remove' and a.target_id is distinct from chat_reports.reported_membership_id)
      or (a.action = 'membership.role_change' and (a.target_id is distinct from chat_reports.reported_membership_id or a.metadata->>'to' = 'TENANT_ADMIN'))
      or (a.action = 'membership.suspend' and a.target_id is distinct from chat_reports.reported_membership_id and ${changedAnAdmin})
      or (a.action = 'membership.reinstate' and ${changedAnAdmin})
      or (a.action = 'membership.approve' and a.metadata->>'role' = 'TENANT_ADMIN')
      or (a.action = 'membership.approve_all' and a.metadata->'adminIds' is not null)
    ))
    or (a.action in ('platform.admin.grant', 'platform.admin.revoke') and ${flaggedAnAdminThere} and not ${reportNamesUser(sql`a.target_id`)})
  ))`;

/**
 * A member of staff (an id, or a column of the query around it) may take the report: it doesn't name them, and they
 * haven't changed its institution's admins since it was filed.
 */
const staffMayTake = (userId: string | SQL): SQL => sql`(not ${reportNamesUser(userId)} and not ${rosterChangedBy(userId)})`;

/** Some member of Illuminize staff may take the report. */
const someStaffMayTake: SQL = sql`exists (select 1 from users u where u.is_platform_admin and ${staffMayTake(sql`u.id`)})`;

export interface ChatReportScope {
  viewerUserId: string;
  /** Illuminize staff reach only what's escalated. */
  escalatedOnly: boolean;
}

const inScope = ({ viewerUserId, escalatedOnly }: ChatReportScope) => and(sql`not ${reportNamesUser(viewerUserId)}`, escalatedOnly ? reportIsEscalated : undefined);

const reporter = alias(memberships, "reporter");
const reported = alias(memberships, "reported");
const reporterColumns = { id: reporter.id, fullName: reporter.fullName, avatarUrl: reporter.avatarUrl, startYear: reporter.startYear, batchYear: reporter.batchYear };
const reportedColumns = { id: reported.id, fullName: reported.fullName, avatarUrl: reported.avatarUrl, startYear: reported.startYear, batchYear: reported.batchYear };

/** What a queue may show. Nothing anyone wrote is selected, so nothing a queue serves can quote a message. */
const queueColumns = {
  id: chatReports.id,
  targetKind: chatReports.targetKind,
  reason: chatReports.reason,
  status: chatReports.status,
  resolutionAction: chatReports.resolutionAction,
  resolvedAt: chatReports.resolvedAt,
  createdAt: chatReports.createdAt,
};

export interface ChatReportQueueRow {
  report: { [K in keyof typeof queueColumns]: ChatReportRow[K] };
  reporter: ChatSender | null;
  reported: ChatSender | null;
}

const newestFirst = [desc(chatReports.createdAt), desc(chatReports.id)];

export async function listChatReports(db: DbClient, tenantId: string, scope: ChatReportScope, q: { status: ReportStatus; page: number; pageSize: number }): Promise<{ rows: ChatReportQueueRow[]; total: number }> {
  const where = and(eq(chatReports.tenantId, tenantId), eq(chatReports.status, q.status), inScope(scope));
  const [rows, [count]] = await Promise.all([
    db
      .select({ report: queueColumns, reporter: reporterColumns, reported: reportedColumns })
      .from(chatReports)
      .leftJoin(reporter, eq(reporter.id, chatReports.reporterMembershipId))
      .leftJoin(reported, eq(reported.id, chatReports.reportedMembershipId))
      .where(where)
      .orderBy(...newestFirst)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(chatReports).where(where),
  ]);
  return { rows, total: count?.count ?? 0 };
}

export interface EscalatedChatReportRow extends ChatReportQueueRow {
  tenant: { slug: string; name: string };
  /** Why it's staff's: about an admin when true, otherwise no other admin can handle it. */
  reportedIsAdmin: boolean;
  /** This staff user changed the institution's admins after it was filed, so another member of staff handles it. */
  needsOtherStaff: boolean;
  /** No member of staff may take it at present: this one needs another, and every other is named in it or changed its admins too. */
  noStaffCanTake: boolean;
}

/** For the platform console: every institution's escalated reports, leaving out any naming this staff user. */
export async function listEscalatedChatReports(db: DbClient, viewerUserId: string, q: { status: ReportStatus; page: number; pageSize: number }): Promise<{ rows: EscalatedChatReportRow[]; total: number }> {
  const where = and(eq(chatReports.status, q.status), inScope({ viewerUserId, escalatedOnly: true }));
  const needsOtherStaff = rosterChangedBy(viewerUserId);
  const [rows, [count]] = await Promise.all([
    db
      .select({
        report: queueColumns,
        reporter: reporterColumns,
        reported: reportedColumns,
        tenant: { slug: tenants.slug, name: tenants.name },
        reportedIsAdmin: sql<boolean>`${reportedIsAdmin}`,
        needsOtherStaff: sql<boolean>`${needsOtherStaff}`,
        // Looked for only when this member of staff can't take it themselves.
        noStaffCanTake: sql<boolean>`case when ${needsOtherStaff} then not ${someStaffMayTake} else false end`,
      })
      .from(chatReports)
      .innerJoin(tenants, eq(tenants.id, chatReports.tenantId))
      .leftJoin(reporter, eq(reporter.id, chatReports.reporterMembershipId))
      .leftJoin(reported, eq(reported.id, chatReports.reportedMembershipId))
      .where(where)
      .orderBy(...newestFirst)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(chatReports).where(where),
  ]);
  return { rows, total: count?.count ?? 0 };
}

export async function countOpenChatReports(db: DbClient, tenantId: string, scope: ChatReportScope): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatReports)
    .where(and(eq(chatReports.tenantId, tenantId), eq(chatReports.status, "OPEN"), inScope(scope)));
  return row?.count ?? 0;
}

export interface FoundChatReport {
  report: ChatReportRow;
  reporter: ChatSender | null;
  reported: ChatSender | null;
  named: boolean;
  escalated: boolean;
  /** Which of the two reasons for escalating applies, when one does. */
  reportedIsAdmin: boolean;
  /** The viewer changed the institution's admins after it was filed (see rosterChangedBy). */
  rosterChangedByViewer: boolean;
}

/** One report and how it stands for this viewer. */
export async function findChatReport(db: DbClient, tenantId: string, id: string, viewerUserId: string): Promise<FoundChatReport | undefined> {
  const [row] = await db
    .select({
      report: chatReports,
      reporter: reporterColumns,
      reported: reportedColumns,
      named: sql<boolean>`${reportNamesUser(viewerUserId)}`,
      escalated: sql<boolean>`${reportIsEscalated}`,
      reportedIsAdmin: sql<boolean>`${reportedIsAdmin}`,
      rosterChangedByViewer: sql<boolean>`${rosterChangedBy(viewerUserId)}`,
    })
    .from(chatReports)
    .leftJoin(reporter, eq(reporter.id, chatReports.reporterMembershipId))
    .leftJoin(reported, eq(reported.id, chatReports.reportedMembershipId))
    .where(and(eq(chatReports.tenantId, tenantId), eq(chatReports.id, id)))
    .limit(1);
  return row;
}

/** Holds the report until the transaction ends, so that whoever gets it second finds it already handled. */
export async function lockChatReport(tx: Tx, tenantId: string, id: string): Promise<ChatReportRow | undefined> {
  const [row] = await tx
    .select()
    .from(chatReports)
    .where(and(eq(chatReports.tenantId, tenantId), eq(chatReports.id, id)))
    .for("update");
  return row;
}

export type ChatReportClosing = Pick<ChatReportInsert, "status" | "resolutionAction" | "resolvedByUserId" | "resolvedAt" | "resolutionNote">;

export async function closeChatReport(db: DbClient, tenantId: string, id: string, values: ChatReportClosing): Promise<ChatReportRow> {
  const [row] = await db
    .update(chatReports)
    .set(values)
    .where(and(eq(chatReports.tenantId, tenantId), eq(chatReports.id, id)))
    .returning();
  return row!;
}

/**
 * Closes every report still open on a removed message, and says which they were and who filed them. A member of staff
 * closing them (`staffUserId`) leaves open those they changed the institution's admins since, for another member of staff.
 */
export async function closeOpenReportsOnMessage(db: DbClient, tenantId: string, messageId: string, values: ChatReportClosing, staffUserId?: string): Promise<Array<{ id: string; reporterMembershipId: string | null }>> {
  return db
    .update(chatReports)
    .set(values)
    .where(and(eq(chatReports.tenantId, tenantId), eq(chatReports.targetKind, "MESSAGE"), eq(chatReports.targetId, messageId), eq(chatReports.status, "OPEN"), staffUserId ? sql`not ${rosterChangedBy(staffUserId)}` : undefined))
    .returning({ id: chatReports.id, reporterMembershipId: chatReports.reporterMembershipId });
}

/**
 * Holds a member, as the subject of chat reports, until the transaction ends. Filing a report about them takes it shared
 * ("file"), so filers don't wait on each other; the check that holds back a reported admin takes it exclusive ("check")
 * before it looks for an open report. A report filed during an admin's change then either commits first, and the check
 * sees it, or waits until the change has committed. There's no row to lock for this: a lock on the member's row would hold
 * up every insert that points at it. It comes before any other lock (see CLAUDE.md, Chat).
 */
export async function lockReportSubject(tx: Tx, tenantId: string, membershipId: string, mode: "file" | "check"): Promise<void> {
  const key = sql`hashtextextended(${`chat-report-subject:${tenantId}:${membershipId}`}, 0)`;
  await tx.execute(mode === "file" ? sql`select pg_advisory_xact_lock_shared(${key})` : sql`select pg_advisory_xact_lock(${key})`);
}

export interface ClaimedReport {
  id: string;
  tenantId: string;
  /** The staff_alerted_at this claim set, which tells one escalation's alerts from a later one's. */
  claimedAt: Date;
}

/**
 * Marks open escalated reports that staff haven't been told about as told, oldest first, and returns them, so each is
 * alerted once while it stays theirs. Leaves a report no member of staff may take (every one is named in it or changed its
 * institution's admins since) for when one may. One statement, which skips rows another transaction holds (another sweep,
 * or an admin closing the report): the next sweep finds them if they're still open.
 */
export async function claimEscalatedReports(db: DbClient, opts: { reportId?: string; limit: number }): Promise<ClaimedReport[]> {
  const unalerted = db
    .select({ id: chatReports.id })
    .from(chatReports)
    .where(and(eq(chatReports.status, "OPEN"), isNull(chatReports.staffAlertedAt), reportIsEscalated, someStaffMayTake, opts.reportId ? eq(chatReports.id, opts.reportId) : undefined))
    .orderBy(asc(chatReports.createdAt))
    .limit(opts.limit)
    .for("update", { skipLocked: true });
  const rows = await db
    .update(chatReports)
    .set({ staffAlertedAt: sql`now()` })
    .where(inArray(chatReports.id, unalerted))
    .returning({ id: chatReports.id, tenantId: chatReports.tenantId, claimedAt: chatReports.staffAlertedAt });
  return rows.map((r) => ({ ...r, claimedAt: r.claimedAt! }));
}

/**
 * The members of Illuminize staff who may take the report (see staffMayTake), whom its alerts go to. users.id is spelled
 * out: in a single-table select Drizzle leaves the table off an interpolated column, and a bare id here would mean the
 * membership's.
 */
export async function listStaffWhoMayTake(db: DbClient, reportId: string): Promise<UserRow[]> {
  return db
    .select()
    .from(users)
    .where(and(eq(users.isPlatformAdmin, true), sql`exists (select 1 from chat_reports where chat_reports.id = ${reportId} and ${staffMayTake(sql`users.id`)})`))
    .orderBy(users.createdAt);
}

/**
 * Marks an open report as not yet told to staff, when its alerts went to nobody: none was left to send them to, or it
 * stopped being theirs before they went out. The next sweep claims it again once it's theirs.
 */
export async function releaseStaffAlert(db: DbClient, tenantId: string, id: string): Promise<void> {
  await db
    .update(chatReports)
    .set({ staffAlertedAt: null })
    .where(and(eq(chatReports.tenantId, tenantId), eq(chatReports.id, id), eq(chatReports.status, "OPEN")));
}

/** Whether this member is the subject of a report nobody has closed yet. */
export async function hasOpenReportAbout(db: DbClient, tenantId: string, membershipId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: chatReports.id })
    .from(chatReports)
    .where(and(eq(chatReports.tenantId, tenantId), eq(chatReports.reportedMembershipId, membershipId), eq(chatReports.status, "OPEN")))
    .limit(1);
  return !!row;
}

/**
 * The messages shown for a report, oldest first. This is the only function that returns other people's messages to someone
 * outside the conversation, so it reads only the ids frozen when the report was filed, whatever else the thread holds. It
 * always includes the target, which is the one place a removed message can still be read, and leaves out anything else that
 * has since been removed. A report on a request rather than a message has no messages to show.
 */
export async function chatReportContext(db: DbClient, report: Pick<ChatReportRow, "tenantId" | "targetKind" | "targetId" | "contextMessageIds">): Promise<MessageWithSender[]> {
  if (report.targetKind !== "MESSAGE") return [];
  return db
    .select({ message: chatMessages, sender: senderColumns })
    .from(chatMessages)
    .leftJoin(memberships, eq(memberships.id, chatMessages.senderMembershipId))
    .where(and(eq(chatMessages.tenantId, report.tenantId), inArray(chatMessages.id, [...report.contextMessageIds, report.targetId]), eq(chatMessages.withheld, false), or(isNull(chatMessages.removedAt), eq(chatMessages.id, report.targetId))))
    .orderBy(asc(chatMessages.seq));
}
