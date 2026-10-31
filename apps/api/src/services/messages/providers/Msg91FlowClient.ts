import type { Logger } from "../../../lib/logger";
import { MessageSendError, type ChannelSender, type RenderedMessage } from "../types";

/**
 * MSG91 Flow API for transactional SMS (DLT-registered templates in India). OTPs use MSG91's separate OTP API.
 * Docs: https://docs.msg91.com/reference/send-sms
 */
export class Msg91FlowClient {
  constructor(
    private readonly cfg: { authKey: string },
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(toE164: string, flowTemplateId: string, vars: Record<string, string>): Promise<{ requestId: string | null }> {
    let res: Response;
    try {
      res = await this.fetchImpl("https://control.msg91.com/api/v5/flow", {
        method: "POST",
        headers: { authkey: this.cfg.authKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ template_id: flowTemplateId, short_url: "0", recipients: [{ mobiles: toE164.replace(/^\+/, ""), ...vars }] }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new MessageSendError("msg91", "network error", true, err);
    }
    const json = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    if (!res.ok || json.type === "error") {
      this.logger.warn({ status: res.status, message: json.message }, "MSG91 rejected an SMS");
      throw new MessageSendError("msg91", json.message ? `${res.status}: ${json.message}` : `HTTP ${res.status}`, res.status === 429 || res.status >= 500);
    }
    return { requestId: json.message ?? null };
  }
}

export class Msg91SmsSender implements ChannelSender<"SMS"> {
  readonly channel = "SMS" as const;
  readonly provider = "msg91";
  constructor(private readonly client: Msg91FlowClient) {}
  async send(m: Extract<RenderedMessage, { channel: "SMS" }>) {
    const { requestId } = await this.client.send(m.to, m.flowTemplateId, m.vars);
    return { providerMessageId: requestId };
  }
}
