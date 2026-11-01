import type { Config } from "../config/env";
import type { JobName, JobPayloads } from "./definitions";

/**
 * Recurring jobs. The worker syncs this list on start: new entries are scheduled, changed ones updated, and schedules
 * no longer listed are removed. Work that happens at a local time in each institution (celebrations, the digest) runs
 * from the engagement tick rather than its own schedule.
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

export const scheduledJobs: ScheduledJob[] = [
  { id: "push-receipts", job: "push.checkReceipts", data: {}, repeat: { every: 5 * 60_000 } },
  { id: "messages-sweep", job: "messages.sweep", data: {}, repeat: { every: 5 * 60_000 } },
  // Every 15 minutes, because some zones are offset by half an hour (India) or 45 minutes (Nepal).
  { id: "engagement-tick", job: "engagement.tick", data: {}, repeat: { every: 15 * 60_000 } },
];
