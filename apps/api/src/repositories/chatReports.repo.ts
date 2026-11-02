import type { DbClient } from "../db/client";
import { chatReports } from "../db/schema";

export type ChatReportRow = typeof chatReports.$inferSelect;
export type ChatReportInsert = typeof chatReports.$inferInsert;

/** Undefined when this reporter already reported this message. */
export async function insertChatReport(db: DbClient, values: ChatReportInsert): Promise<ChatReportRow | undefined> {
  const [row] = await db.insert(chatReports).values(values).onConflictDoNothing().returning();
  return row;
}
