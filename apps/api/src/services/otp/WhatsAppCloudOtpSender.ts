import type { Logger } from "../../lib/logger";
import { WhatsAppCloudClient } from "../messages/providers/WhatsAppCloudClient";
import { MessageSendError } from "../messages/types";
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
  private readonly client: WhatsAppCloudClient;

  constructor(
    private readonly cfg: WhatsAppCloudConfig,
    logger: Logger,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.client = new WhatsAppCloudClient({ accessToken: cfg.accessToken, phoneNumberId: cfg.phoneNumberId, apiVersion: cfg.apiVersion }, logger, fetchImpl);
  }

  async send(phoneE164: string, code: string): Promise<OtpSendResult> {
    try {
      await this.client.sendTemplate(phoneE164, {
        name: this.cfg.templateName,
        language: this.cfg.templateLang,
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ],
      });
    } catch (err) {
      throw new OtpSendError(this.name, err instanceof MessageSendError ? err.message.replace(/^whatsapp: /, "") : "send failed", err);
    }
    return { channel: "whatsapp" };
  }
}
