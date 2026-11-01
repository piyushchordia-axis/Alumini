import type { Transporter } from "nodemailer";
import { MessageSendError, type ChannelSender, type RenderedMessage } from "../types";

const RETRYABLE_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "ETLS"]);

/**
 * Email over SMTP (nodemailer), so any provider works: Amazon SES, Zoho, Google Workspace, Resend, SendGrid…
 * Temporary SMTP replies (4xx) and connection problems are retried; permanent ones (5xx, rejected recipients, bad
 * credentials) are not.
 */
export class SmtpEmailSender implements ChannelSender<"EMAIL"> {
  readonly channel = "EMAIL" as const;
  readonly provider = "smtp";

  constructor(
    private readonly transporter: Pick<Transporter, "sendMail">,
    private readonly from: string,
    private readonly replyTo?: string,
  ) {}

  async send(m: Extract<RenderedMessage, { channel: "EMAIL" }>) {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: m.toName ? { name: m.toName, address: m.to } : m.to,
        ...(this.replyTo ? { replyTo: this.replyTo } : {}),
        subject: m.subject,
        text: m.text,
        ...(m.html ? { html: m.html } : {}),
        ...(m.headers ? { headers: m.headers } : {}),
      });
      return { providerMessageId: (info as { messageId?: string }).messageId ?? null };
    } catch (err) {
      const e = err as { responseCode?: number; code?: string; message?: string };
      const retryable = e.responseCode ? e.responseCode >= 400 && e.responseCode < 500 : RETRYABLE_CODES.has(e.code ?? "");
      throw new MessageSendError("smtp", e.responseCode ? `SMTP ${e.responseCode}: ${e.message ?? ""}`.trim() : (e.message ?? "send failed"), retryable, err);
    }
  }
}
