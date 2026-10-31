import type { MessageChannel } from "@illuminize/shared";

/** A WhatsApp template message: the approved template's name and its filled-in parameters. */
export interface WhatsAppTemplateSpec {
  name: string;
  /** Template language code, e.g. "en_US" or "en". */
  language: string;
  components: Array<{
    type: "header" | "body" | "button";
    sub_type?: "url" | "quick_reply";
    index?: string;
    parameters: Array<{ type: "text"; text: string }>;
  }>;
}

/** A message ready for one channel: who it goes to and exactly what the provider needs. */
export type RenderedMessage =
  | { channel: "WHATSAPP"; to: string; template: WhatsAppTemplateSpec }
  | { channel: "SMS"; to: string; flowTemplateId: string; vars: Record<string, string> }
  | { channel: "EMAIL"; to: string; toName?: string | null; subject: string; text: string; html?: string };

/** Sends rendered messages over one channel through one provider. */
export interface ChannelSender<C extends MessageChannel = MessageChannel> {
  readonly channel: C;
  readonly provider: string;
  send(message: Extract<RenderedMessage, { channel: C }>): Promise<{ providerMessageId: string | null }>;
}

export type MessageSenders = Partial<{ [C in MessageChannel]: ChannelSender<C> }>;

/** A provider failure; `retryable` decides whether the message is tried again later. */
export class MessageSendError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(`${provider}: ${message}`, { cause });
    this.name = "MessageSendError";
  }
}

export interface MessageRecipient {
  phoneE164?: string | null;
  email?: string | null;
  name?: string | null;
  userId?: string | null;
}
