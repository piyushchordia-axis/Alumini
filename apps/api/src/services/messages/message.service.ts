import type { MessageChannel } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient } from "../../db/client";
import type { OutboundMessageError } from "../../db/schema/messages";
import type { JobMeta } from "../../jobs/JobQueue";
import { afterCommit } from "../../lib/transaction";
import {
  findMessage,
  findMessageByDedupeKey,
  findStaleMessages,
  insertMessage,
  insertMessages,
  updateMessage,
  type OutboundMessageInsert,
  type OutboundMessageRow,
} from "../../repositories/messages.repo";
import { BULK_MESSAGE_TYPES, isMessageType, messageTemplates, renderForChannel, type MessagePayloads, type MessageTemplate, type MessageType } from "./templates";
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

const TERMINAL = new Set(["SENT", "DELIVERED", "READ", "FAILED", "CANCELLED"]);
const jobIdFor = (messageId: string) => `msg-${messageId}`;
const templateFor = (type: MessageType) => messageTemplates[type] as unknown as MessageTemplate<MessageType>;
const priorityOf = (type: string) => (isMessageType(type) ? messageTemplates[type].priority : 10);

function toInsert<T extends MessageType>(input: QueueMessageInput<T>): OutboundMessageInsert {
  return {
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
  };
}

/**
 * Records a message and queues it for sending once `db`'s work commits. Returns the stored row (status QUEUED), or the
 * existing row for a repeated dedupe key.
 */
export async function queueMessage<T extends MessageType>(ctx: AppContext, input: QueueMessageInput<T>, db: DbClient = ctx.db): Promise<OutboundMessageRow> {
  const row = await insertMessage(db, toInsert(input));
  if (!row) {
    const existing = input.dedupeKey ? await findMessageByDedupeKey(db, input.dedupeKey) : undefined;
    if (!existing) throw new Error("Message insert conflicted but no existing row was found");
    return existing;
  }
  await afterCommit(ctx, db, () => ctx.jobs.enqueue("messages.send", { messageId: row.id }, { jobId: jobIdFor(row.id), priority: priorityOf(row.type) }));
  return row;
}

/**
 * Bulk version of queueMessage for fan-outs (digest, announcements, invites): inserts in chunks and enqueues every new
 * row in one round trip after commit. Inputs whose dedupe key already exists are skipped. Returns the new rows.
 */
export async function queueMessages<T extends MessageType>(ctx: AppContext, inputs: Array<QueueMessageInput<T>>, db: DbClient = ctx.db): Promise<OutboundMessageRow[]> {
  const created: OutboundMessageRow[] = [];
  for (let i = 0; i < inputs.length; i += 500) created.push(...(await insertMessages(db, inputs.slice(i, i + 500).map(toInsert))));
  if (created.length) {
    await afterCommit(ctx, db, () =>
      ctx.jobs.enqueueBulk(created.map((row) => ({ name: "messages.send", data: { messageId: row.id }, opts: { jobId: jobIdFor(row.id), priority: priorityOf(row.type) } }))),
    );
  }
  return created;
}

/** The stored payload without the template's secret keys (applied once a message is final). */
function withoutSecrets(template: MessageTemplate<MessageType>, payload: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!template.secretKeys?.length) return undefined;
  const rest = { ...payload };
  for (const key of template.secretKeys) delete rest[key];
  return rest;
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
  if (!isMessageType(row.type)) {
    await updateMessage(ctx.db, row.id, { status: "FAILED", errors, lastError: `Unknown message type "${row.type}"`, failedAt: new Date() });
    return;
  }
  const template = templateFor(row.type);
  const scrubbed = withoutSecrets(template, row.payload);
  const fail = async (reason: string) => {
    await updateMessage(ctx.db, row.id, { status: "FAILED", errors, lastError: reason, failedAt: new Date(), ...(scrubbed ? { payload: scrubbed } : {}) });
  };
  await updateMessage(ctx.db, row.id, { status: "SENDING", attempts: row.attempts + 1 });

  let payload: unknown = row.payload;
  let to = { phone: row.toPhone, email: row.toEmail, name: row.toName };
  if (template.load) {
    let loaded;
    try {
      loaded = await template.load(ctx, row.payload as never, { messageId: row.id, tenantId: row.tenantId, recipientUserId: row.recipientUserId });
    } catch (err) {
      const reason = `load failed: ${err instanceof Error ? err.message : String(err)}`;
      if (meta.attempt < meta.maxAttempts) {
        await updateMessage(ctx.db, row.id, { status: "QUEUED", lastError: reason });
        throw err;
      }
      return fail(reason);
    }
    if ("cancel" in loaded) {
      await updateMessage(ctx.db, row.id, { status: "CANCELLED", lastError: loaded.cancel, ...(scrubbed ? { payload: scrubbed } : {}) });
      return;
    }
    payload = loaded.payload;
    if (loaded.to) to = { phone: loaded.to.phone !== undefined ? loaded.to.phone : to.phone, email: loaded.to.email !== undefined ? loaded.to.email : to.email, name: loaded.to.name !== undefined ? loaded.to.name : to.name };
  }

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
    const rendered = renderForChannel(row.type, channel, payload, to, ctx.config.msg91FlowTemplateIds);
    if ("skip" in rendered) {
      note(channel, sender.provider, rendered.skip, false);
      continue;
    }
    const message = rendered.message;
    try {
      // The sender for a channel always receives that channel's rendered shape (renderForChannel guarantees it).
      const { providerMessageId } = await (sender.send as (m: typeof message) => Promise<{ providerMessageId: string | null }>)(message);
      await updateMessage(ctx.db, row.id, {
        status: "SENT",
        channel,
        provider: sender.provider,
        providerMessageId,
        errors,
        lastError: null,
        sentAt: new Date(),
        ...(to.email !== row.toEmail ? { toEmail: to.email } : {}),
        ...(to.phone !== row.toPhone ? { toPhone: to.phone } : {}),
        ...(scrubbed ? { payload: scrubbed } : {}),
      });
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

/**
 * Re-queues messages a crash left behind: QUEUED over 5 minutes (bulk types: over an hour, since a large fan-out can
 * legitimately wait that long behind the rate limit) and SENDING over 15. Re-queueing a job that still exists is a
 * no-op (same job id). Returns how many were re-queued.
 */
export async function sweepMessages(ctx: AppContext, now = new Date()): Promise<number> {
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  const stale = await findStaleMessages(ctx.db, { queuedBefore: minutesAgo(5), bulkQueuedBefore: minutesAgo(60), bulkTypes: BULK_MESSAGE_TYPES, sendingBefore: minutesAgo(15), limit: 500 });
  if (stale.length) {
    await ctx.jobs.enqueueBulk(stale.map((m) => ({ name: "messages.send", data: { messageId: m.id }, opts: { jobId: jobIdFor(m.id), priority: priorityOf(m.type) } })));
    ctx.logger.warn({ count: stale.length }, "Re-queued stale outbound messages");
  }
  return stale.length;
}
