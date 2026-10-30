import type { Logger } from "../../lib/logger";
import type { OtpSender, OtpSendResult } from "./OtpSender";

/** Development sender: writes the code to the log instead of delivering it. */
export class ConsoleOtpSender implements OtpSender {
  readonly name = "console";
  constructor(private readonly logger: Logger) {}

  async send(phoneE164: string, code: string): Promise<OtpSendResult> {
    this.logger.info({ phone: phoneE164, code }, "[OTP] code generated (console sender)");
    return { channel: "console" };
  }
}
