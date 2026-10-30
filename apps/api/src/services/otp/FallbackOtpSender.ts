import type { Logger } from "../../lib/logger";
import type { OtpSender, OtpSendResult } from "./OtpSender";

/** Tries the primary channel and falls back to the secondary one on any delivery error. */
export class FallbackOtpSender implements OtpSender {
  readonly name: string;

  constructor(
    private readonly primary: OtpSender,
    private readonly fallback: OtpSender,
    private readonly logger: Logger,
  ) {
    this.name = `${primary.name}+${fallback.name}`;
  }

  async send(phoneE164: string, code: string): Promise<OtpSendResult> {
    try {
      return await this.primary.send(phoneE164, code);
    } catch (err) {
      this.logger.warn({ err, provider: this.primary.name, fallback: this.fallback.name }, "Primary OTP delivery failed, using fallback");
      return this.fallback.send(phoneE164, code);
    }
  }
}
