import type { Logger } from "../../lib/logger";
import { OtpSendError, type OtpSender, type OtpSendResult } from "./OtpSender";

export interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  templateLang: string;
  apiVersion: string;
}

/**
 * Sends the OTP through Meta's WhatsApp Business Cloud API using an approved
 * *authentication* template (body "{{1}}" + copy-code URL button).
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
 */
export class WhatsAppCloudOtpSender implements OtpSender {
  readonly name = "whatsapp";

  constructor(
    private readonly cfg: WhatsAppCloudConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(phoneE164: string, code: string): Promise<OtpSendResult> {
    const url = `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phoneE164.replace(/^\+/, ""),
      type: "template",
      template: {
        name: this.cfg.templateName,
        language: { code: this.cfg.templateLang },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ],
      },
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
      throw new OtpSendError(this.name, "network error", err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.warn({ status: res.status, body: text.slice(0, 500) }, "WhatsApp Cloud API rejected OTP message");
      throw new OtpSendError(this.name, `HTTP ${res.status}`);
    }
    return { channel: "whatsapp" };
  }
}
