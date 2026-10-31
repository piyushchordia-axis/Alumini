import type { Logger } from "../../../lib/logger";
import { MessageSendError, type ChannelSender, type RenderedMessage, type WhatsAppTemplateSpec } from "../types";

export interface WhatsAppCloudClientConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
}

/**
 * Meta WhatsApp Business Cloud API: template messages. Shared by the OTP sender and outbound messages.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
 */
export class WhatsAppCloudClient {
  constructor(
    private readonly cfg: WhatsAppCloudClientConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Sends a template message; returns Meta's message id. 429, 5xx and network errors are retryable. */
  async sendTemplate(toE164: string, template: WhatsAppTemplateSpec): Promise<{ messageId: string | null }> {
    const url = `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toE164.replace(/^\+/, ""),
      type: "template",
      template: { name: template.name, language: { code: template.language }, components: template.components },
    };
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new MessageSendError("whatsapp", "network error", true, err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.warn({ status: res.status, body: text.slice(0, 500) }, "WhatsApp Cloud API rejected a message");
      throw new MessageSendError("whatsapp", `HTTP ${res.status}`, res.status === 429 || res.status >= 500);
    }
    const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
    return { messageId: json.messages?.[0]?.id ?? null };
  }
}

export class WhatsAppTemplateSender implements ChannelSender<"WHATSAPP"> {
  readonly channel = "WHATSAPP" as const;
  readonly provider = "whatsapp";
  constructor(private readonly client: WhatsAppCloudClient) {}
  async send(m: Extract<RenderedMessage, { channel: "WHATSAPP" }>) {
    const { messageId } = await this.client.sendTemplate(m.to, m.template);
    return { providerMessageId: messageId };
  }
}
