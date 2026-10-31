import type { Config } from "../config/env";
import type { JobName, JobPayloads } from "./definitions";

/**
 * Recurring jobs. The worker syncs this list on start: new entries are scheduled, changed ones updated, and schedules
 * no longer listed are removed. Wave 1 adds the weekly digest, birthday wishes and event reminders here.
 */
export interface ScheduledJob<N extends JobName = JobName> {
  /** Stable id; changing it creates a new schedule and removes the old one. */
  id: string;
  job: N;
  data: JobPayloads[N];
  /** Every N milliseconds, or a cron pattern in a time zone. */
  repeat: { every: number } | { pattern: string; tz?: string };
  enabled?: (config: Config) => boolean;
}

export const scheduledJobs: ScheduledJob[] = [{ id: "push-receipts", job: "push.checkReceipts", data: {}, repeat: { every: 5 * 60_000 } }];
