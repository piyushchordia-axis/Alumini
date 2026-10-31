import type { MessageChannel } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient } from "../../db/client";
import type { OutboundMessageError } from "../../db/schema/messages";
import type { JobMeta } from "../../jobs/JobQueue";
import { afterCommit } from "../../lib/transaction";
import { findMessage, findMessageByDedupeKey, findStaleMessageIds, insertMessage, updateMessage, type OutboundMessageRow } from "../../repositories/messages.repo";
import { isMessageType, messageTemplates, renderForChannel, type MessagePayloads, type MessageType } from "./templates";
import { MessageSendError, type MessageRecipient } from "./types";

export interface QueueMessageInput<T extends MessageType> {
  type: T;
  tenantId?: string | null;
  to: MessageRecipient;
  payload: MessagePayloads[T];
  /** Overrides the template's channel order. */
  channels?: readonly MessageChannel[];
  /** Sending the same key twice returns the first message instead of sending again. */
  dedupeKey?: string;
  /** What the message is about, e.g. { type: "invite", id }. */
  context?: { type: string; id: string };
}

const TERMINAL = new Set(["SENT", "DELIVERED", "READ", "FAILED"]);
const jobIdFor = (messageId: string) => `msg-${messageId}`;

/**
 * Records a message and queues it for sending once `db`'s work commits. Returns the stored row (status QUEUED), or the
 * existing row for a repeated dedupe key.
 */
export async function queueMessage<T extends MessageType>(ctx: AppContext, input: QueueMessageInput<T>, db: DbClient = ctx.db): Promise<OutboundMessageRow> {
  const row = await insertMessage(db, {
    tenantId: input.tenantId ?? null,
    type: input.type,
    channels: [...(input.channels ?? messageTemplates[input.type].channels)],
    toPhone: input.to.phoneE164 ?? null,
    toEmail: input.to.email ?? null,
    toName: input.to.name ?? null,
    recipientUserId: input.to.userId ?? null,
    contextType: input.context?.type ?? null,
    contextId: input.context?.id ?? null,
    payload: input.payload as Record<string, unknown>,
    dedupeKey: input.dedupeKey ?? null,
  });
  if (!row) {
    const existing = input.dedupeKey ? await findMessageByDedupeKey(db, input.dedupeKey) : undefined;
    if (!existing) throw new Error("Message insert conflicted but no existing row was found");
    return existing;
  }
  await afterCommit(ctx, db, () => ctx.jobs.enqueue("messages.send", { messageId: row.id }, { jobId: jobIdFor(row.id) }));
  return row;
}

/**
 * The messages.send job. Tries the message's channels in order and records every failure. Gives up on a channel that
 * fails for good and moves to the next; if every channel failed and any failure was temporary, throws so the job is
 * retried later; on the last attempt (or when nothing was temporary) marks the message FAILED.
 */
export async function processMessage(ctx: AppContext, messageId: string, meta: JobMeta): Promise<void> {
  const row = await findMessage(ctx.db, messageId);
  if (!row || TERMINAL.has(row.status)) return;
  const errors: OutboundMessageError[] = [...row.errors];
  const fail = async (reason: string) => {
    await updateMessage(ctx.db, row.id, { status: "FAILED", errors, lastError: reason, failedAt: new Date() });
  };
  if (!isMessageType(row.type)) return fail(`Unknown message type "${row.type}"`);
  await updateMessage(ctx.db, row.id, { status: "SENDING", attempts: row.attempts + 1 });

  let anyRetryable = false;
  const note = (channel: MessageChannel, provider: string, error: string, retryable: boolean) => {
    errors.push({ at: new Date().toISOString(), channel, provider, error, retryable });
    anyRetryable ||= retryable;
  };
  for (const channel of row.channels) {
    const sender = ctx.messageSenders[channel];
    if (!sender) {
      note(channel, "none", "channel not configured", false);
      continue;
    }
    const rendered = renderForChannel(row.type, channel, row.payload, { phone: row.toPhone, email: row.toEmail, name: row.toName }, ctx.config.msg91FlowTemplateIds);
    if ("skip" in rendered) {
      note(channel, sender.provider, rendered.skip, false);
      continue;
    }
    const message = rendered.message;
    try {
      // The sender for a channel always receives that channel's rendered shape (renderForChannel guarantees it).
      const { providerMessageId } = await (sender.send as (m: typeof message) => Promise<{ providerMessageId: string | null }>)(message);
      await updateMessage(ctx.db, row.id, { status: "SENT", channel, provider: sender.provider, providerMessageId, errors, lastError: null, sentAt: new Date() });
      return;
    } catch (err) {
      const retryable = err instanceof MessageSendError ? err.retryable : true;
      note(channel, sender.provider, err instanceof Error ? err.message : String(err), retryable);
    }
  }

  const lastError = errors[errors.length - 1]?.error ?? "no channel could send this message";
  if (anyRetryable && meta.attempt < meta.maxAttempts) {
    await updateMessage(ctx.db, row.id, { status: "QUEUED", errors, lastError });
    throw new Error(`Message ${row.id} not sent yet: ${lastError}`);
  }
  await fail(lastError);
}

/** Re-queues messages a crash left behind (QUEUED over 5 minutes, SENDING over 15). Returns how many. */
export async function sweepMessages(ctx: AppContext, now = new Date()): Promise<number> {
  const ids = await findStaleMessageIds(ctx.db, new Date(now.getTime() - 5 * 60_000), new Date(now.getTime() - 15 * 60_000), 500);
  for (const id of ids) await ctx.jobs.enqueue("messages.send", { messageId: id }, { jobId: jobIdFor(id) });
  if (ids.length) ctx.logger.warn({ count: ids.length }, "Re-queued stale outbound messages");
  return ids.length;
}
