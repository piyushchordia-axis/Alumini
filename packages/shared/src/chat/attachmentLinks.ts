import { CHAT_ATTACHMENT_LINKS_PER_CALL } from "../constants";
import type { ChatAttachmentLinkDto, ChatAttachmentLinksDto } from "../types/dto";

/** One message's signed links, as a bubble asks for them, though they're fetched for several messages at once. */
export interface MessageAttachmentLinks {
  /** When every link here stops working. */
  expiresAt: string;
  /** None when the member may no longer see the message's photos and files. */
  links: ChatAttachmentLinkDto[];
}

export type FetchAttachmentLinks = (slug: string, conversationId: string, messageIds: readonly string[]) => Promise<ChatAttachmentLinksDto>;

export interface AttachmentLinkLoader {
  load(slug: string, conversationId: string, messageId: string): Promise<MessageAttachmentLinks>;
}

interface Waiter {
  resolve: (links: MessageAttachmentLinks) => void;
  reject: (err: unknown) => void;
}

interface Batch {
  slug: string;
  conversationId: string;
  waiting: Map<string, Waiter[]>;
}

/**
 * Asks for the links of every message that wants them within `waitMs` of the first, in one request per conversation (or
 * one per CHAT_ATTACHMENT_LINKS_PER_CALL messages), so a thread opening on ten photo messages makes one request against
 * the chat-file-links limit rather than ten. Each message gets only its own links; one the member may no longer see gets
 * none, as the API leaves it out rather than refusing it. A failed request fails every message it asked for.
 */
export function createAttachmentLinkLoader(fetchLinks: FetchAttachmentLinks, { waitMs = 10 }: { waitMs?: number } = {}): AttachmentLinkLoader {
  const batches = new Map<string, Batch>();

  const flush = (key: string) => {
    const batch = batches.get(key);
    batches.delete(key);
    if (!batch) return;
    const ids = [...batch.waiting.keys()];
    for (let i = 0; i < ids.length; i += CHAT_ATTACHMENT_LINKS_PER_CALL) {
      const chunk = ids.slice(i, i + CHAT_ATTACHMENT_LINKS_PER_CALL);
      const waiters = (id: string) => batch.waiting.get(id) ?? [];
      Promise.resolve()
        .then(() => fetchLinks(batch.slug, batch.conversationId, chunk))
        .then(
          (answer) => {
            for (const id of chunk) {
              const mine: MessageAttachmentLinks = { expiresAt: answer.expiresAt, links: answer.links.filter((link) => link.messageId === id) };
              for (const w of waiters(id)) w.resolve(mine);
            }
          },
          (err: unknown) => {
            for (const id of chunk) for (const w of waiters(id)) w.reject(err);
          },
        );
    }
  };

  return {
    load(slug, conversationId, messageId) {
      return new Promise<MessageAttachmentLinks>((resolve, reject) => {
        const key = `${slug}\u0000${conversationId}`;
        let batch = batches.get(key);
        if (!batch) {
          batch = { slug, conversationId, waiting: new Map() };
          batches.set(key, batch);
          setTimeout(() => flush(key), waitMs);
        }
        const list = batch.waiting.get(messageId) ?? [];
        list.push({ resolve, reject });
        batch.waiting.set(messageId, list);
      });
    },
  };
}
