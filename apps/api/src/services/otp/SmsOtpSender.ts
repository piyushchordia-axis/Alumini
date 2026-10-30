import type { Logger } from "../../lib/logger";
import { OtpSendError, type OtpSender, type OtpSendResult } from "./OtpSender";

export interface Msg91Config {
  authKey: string;
  templateId: string;
}

/**
 * SMS fallback using the MSG91 OTP API (India-centric vendor with
 * international routes). Swap the request shape for Twilio or another
 * vendor without touching the rest of the OTP flow.
 */
export class SmsOtpSender implements OtpSender {
  readonly name = "sms";

  constructor(
    private readonly cfg: Msg91Config,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(phoneE164: string, code: string): Promise<OtpSendResult> {
    const params = new URLSearchParams({
      template_id: this.cfg.templateId,
      mobile: phoneE164.replace(/^\+/, ""),
      otp: code,
      otp_expiry: "5",
      realTimeResponse: "1",
    });
    let res: Response;
    try {
      res = await this.fetchImpl(`https://control.msg91.com/api/v5/otp?${params.toString()}`, {
        method: "POST",
        headers: { authkey: this.cfg.authKey, "Content-Type": "application/json" },
        body: JSON.stringify({ OTP: code }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new OtpSendError(this.name, "network error", err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.logger.warn({ status: res.status, body: text.slice(0, 500) }, "SMS provider rejected OTP message");
      throw new OtpSendError(this.name, `HTTP ${res.status}`);
    }
    return { channel: "sms" };
  }
}
