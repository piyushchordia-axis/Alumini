import type { MessageChannel } from "@illuminize/shared";
import type { RenderedMessage, WhatsAppTemplateSpec } from "./types";

/**
 * Message types and their parameters. Payloads are stored in outbound_messages.payload, so keep them to the values a
 * template needs (names, links), never secrets. Wave 1 adds INVITE, DIGEST, EVENT_REMINDER and others.
 */
export interface MessagePayloads {
  /** Staff check that WhatsApp, SMS and email are configured (POST /platform/messages/test). */
  PLATFORM_TEST: { sentBy: string; recipientName?: string | null };
}
export type MessageType = keyof MessagePayloads;

export interface MessageTemplate<T extends MessageType> {
  /** Default channel order; the first that works delivers the message. */
  channels: readonly MessageChannel[];
  /** WhatsApp: an approved template in the WhatsApp Business account. */
  whatsapp?: (p: MessagePayloads[T]) => WhatsAppTemplateSpec;
  /** SMS: MSG91 flow variables; the flow template id comes from MSG91_FLOW_TEMPLATE_IDS (DLT-registered text). */
  sms?: (p: MessagePayloads[T]) => Record<string, string>;
  email?: (p: MessagePayloads[T]) => { subject: string; text: string; html?: string };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const messageTemplates: { [T in MessageType]: MessageTemplate<T> } = {
  PLATFORM_TEST: {
    channels: ["WHATSAPP", "SMS", "EMAIL"],
    // Meta's sample template, available on every WhatsApp Business account.
    whatsapp: () => ({ name: "hello_world", language: "en_US", components: [] }),
    sms: (p) => ({ name: p.recipientName ?? "there" }),
    email: (p) => {
      const text = `Hello ${p.recipientName ?? "there"},\n\nThis is a test message from Illuminize, sent by ${p.sentBy}. If you received it, email delivery is working.\n`;
      return { subject: "Illuminize test message", text, html: `<p>${escapeHtml(text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` };
    },
  },
};

export function isMessageType(type: string): type is MessageType {
  return Object.prototype.hasOwnProperty.call(messageTemplates, type);
}

/**
 * Renders one message for one channel, or returns why it cannot go that way (no address for the channel, no template
 * for it, or no MSG91 flow id configured).
 */
export function renderForChannel(
  type: MessageType,
  channel: MessageChannel,
  payload: unknown,
  to: { phone: string | null; email: string | null; name: string | null },
  msg91FlowTemplateIds: Record<string, string>,
): { message: RenderedMessage } | { skip: string } {
  const template = messageTemplates[type] as MessageTemplate<MessageType>;
  const p = payload as MessagePayloads[MessageType];
  switch (channel) {
    case "WHATSAPP":
      if (!to.phone) return { skip: "no phone number" };
      if (!template.whatsapp) return { skip: "no WhatsApp template" };
      return { message: { channel, to: to.phone, template: template.whatsapp(p) } };
    case "SMS": {
      if (!to.phone) return { skip: "no phone number" };
      if (!template.sms) return { skip: "no SMS template" };
      const flowTemplateId = msg91FlowTemplateIds[type];
      if (!flowTemplateId) return { skip: `no MSG91 flow template id for ${type}` };
      return { message: { channel, to: to.phone, flowTemplateId, vars: template.sms(p) } };
    }
    case "EMAIL":
      if (!to.email) return { skip: "no email address" };
      if (!template.email) return { skip: "no email template" };
      return { message: { channel, to: to.email, toName: to.name, ...template.email(p) } };
  }
}
