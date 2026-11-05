import type { AppContext } from "../../context";
import type { Tx } from "../../db/client";
import { runInTransaction } from "../../lib/transaction";
import { claimEscalatedReports, releaseStaffAlert, type ClaimedReport } from "../../repositories/chatReports.repo";
import { listStaffNotNamedBy } from "../../repositories/users.repo";
import { queueMessages } from "../messages/message.service";

const SWEEP_BATCH = 100;

/**
 * Tells Illuminize staff about reports just claimed by claimEscalatedReports, once per claim and staff member, leaving out
 * staff a report names. Queued with no institution, so it's neither billed to the one the report is in nor counted as its
 * messages. The payload holds ids alone; the template reads the rest when it sends, and cancels if the report has closed.
 * A claim left with nobody to tell (staff changed since it was made) is released for a later sweep. Returns how many
 * reports staff were alerted to.
 */
export async function alertStaff(ctx: AppContext, tx: Tx, claimed: ClaimedReport[]): Promise<number> {
  let alerted = 0;
  for (const report of claimed) {
    const staff = await listStaffNotNamedBy(tx, report.id);
    if (!staff.length) {
      await releaseStaffAlert(tx, report.tenantId, report.id);
      continue;
    }
    await queueMessages(
      ctx,
      staff.map((user) => ({
        type: "STAFF_CHAT_REPORT" as const,
        tenantId: null,
        to: { userId: user.id, phoneE164: user.phoneE164, email: user.email, name: user.displayName },
        payload: { chatReportId: report.id, tenantId: report.tenantId },
        // Per claim: a report that stopped being staff's before its alerts went out is claimed again if it becomes theirs.
        dedupeKey: `staff-chat-report-${report.id}-${user.id}-${report.claimedAt.getTime()}`,
        context: { type: "chat_report", id: report.id },
      })),
      tx,
    );
    alerted++;
  }
  return alerted;
}

/**
 * Inside the transaction that files a report: one that's for staff from the start (about an admin, or no admin left to
 * handle it) alerts them at once. Says whether it did, which is whether staff who hold the admin role there may open it.
 */
export async function alertStaffIfEscalated(ctx: AppContext, tx: Tx, reportId: string): Promise<boolean> {
  return (await alertStaff(ctx, tx, await claimEscalatedReports(tx, { reportId, limit: 1 }))) > 0;
}

/**
 * The chatReports.alertStaff job: alerts staff to every open report that has become theirs since it was filed, when the
 * institution's admins changed (a suspension, a demotion, the staff flag, an admin deleting their account), without a hook
 * in each of those paths. Returns how many reports it alerted staff to.
 */
export async function sweepEscalatedChatReports(ctx: AppContext): Promise<number> {
  let total = 0;
  for (;;) {
    const { claimed, alerted } = await runInTransaction(ctx, async (tx) => {
      const rows = await claimEscalatedReports(tx, { limit: SWEEP_BATCH });
      return { claimed: rows.length, alerted: await alertStaff(ctx, tx, rows) };
    });
    total += alerted;
    if (claimed < SWEEP_BATCH) return total;
  }
}
