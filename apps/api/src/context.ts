import type { Config } from "./config/env";
import type { Db } from "./db/client";
import type { JwtSigner } from "./lib/jwt";
import type { Logger } from "./lib/logger";
import type { RedisClient } from "./redis/client";
import type { JobQueue } from "./jobs/JobQueue";
import type { RealtimePublisher } from "./realtime/publisher";
import type { MessageSenders } from "./services/messages/types";
import type { PushChannel } from "./services/notifications/NotificationChannel";
import type { OtpSender } from "./services/otp";
import type { StorageProvider } from "./services/storage";

export interface AppContext {
  config: Config;
  db: Db;
  redis: RedisClient;
  logger: Logger;
  jwt: JwtSigner;
  otpSender: OtpSender;
  storage: StorageProvider;
  /** Background work: BullMQ in the app, in memory in tests. Enqueue after commit (see lib/transaction.ts). */
  jobs: JobQueue;
  /** Push delivery to devices (Expo); absent when not configured, e.g. in tests. */
  push?: PushChannel;
  /** WhatsApp/SMS/email senders per channel; channels without one are skipped. */
  messageSenders: MessageSenders;
  /** Live events to connected apps (Socket.IO); a no-op until the server is attached. */
  realtime: RealtimePublisher;
}
