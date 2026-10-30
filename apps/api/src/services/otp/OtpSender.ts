import type { OtpChannel } from "@illuminize/shared";

export interface OtpSendResult {
  channel: OtpChannel;
}

export interface OtpSender {
  readonly name: string;
  send(phoneE164: string, code: string): Promise<OtpSendResult>;
}

export class OtpSendError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    cause?: unknown,
  ) {
    super(`${provider}: ${message}`, { cause });
    this.name = "OtpSendError";
  }
}
