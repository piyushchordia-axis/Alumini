import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger";
import { WhatsAppCloudOtpSender } from "../../src/services/otp/WhatsAppCloudOtpSender";
import { OtpSendError } from "../../src/services/otp/OtpSender";

const cfg = { accessToken: "tok", phoneNumberId: "12345", templateName: "illuminize_otp", templateLang: "en_US", apiVersion: "v21.0" };

function recordingFetch(status = 200, body = '{"messages":[{"id":"wamid.1"}]}') {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
  return { calls, impl };
}

describe("WhatsApp OTP sender", () => {
  it("sends the authentication template with the code in the body and the copy-code button (request locked)", async () => {
    const f = recordingFetch();
    const sender = new WhatsAppCloudOtpSender(cfg, createLogger("silent", false), f.impl);
    await expect(sender.send("+919876543210", "123456")).resolves.toEqual({ channel: "whatsapp" });
    expect(f.calls[0]!.url).toBe("https://graph.facebook.com/v21.0/12345/messages");
    expect(f.calls[0]!.init.headers).toMatchObject({ Authorization: "Bearer tok", "Content-Type": "application/json" });
    expect(f.calls[0]!.init.body).toBe(
      JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: "919876543210",
        type: "template",
        template: {
          name: "illuminize_otp",
          language: { code: "en_US" },
          components: [
            { type: "body", parameters: [{ type: "text", text: "123456" }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
          ],
        },
      }),
    );
  });

  it("turns HTTP and network failures into OtpSendError", async () => {
    const rejected = new WhatsAppCloudOtpSender(cfg, createLogger("silent", false), recordingFetch(400, '{"error":{}}').impl);
    await expect(rejected.send("+919876543210", "1")).rejects.toBeInstanceOf(OtpSendError);
    const offline = new WhatsAppCloudOtpSender(cfg, createLogger("silent", false), (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch);
    await expect(offline.send("+919876543210", "1")).rejects.toBeInstanceOf(OtpSendError);
  });
});
