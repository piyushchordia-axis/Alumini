import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger";
import { Msg91FlowClient } from "../../src/services/messages/providers/Msg91FlowClient";
import { SmtpEmailSender } from "../../src/services/messages/providers/SmtpEmailSender";
import { WhatsAppCloudClient } from "../../src/services/messages/providers/WhatsAppCloudClient";
import { renderForChannel } from "../../src/services/messages/templates";
import { MessageSendError } from "../../src/services/messages/types";

const logger = createLogger("silent", false);

function fetchReturning(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, impl };
}

async function rejection(p: Promise<unknown>): Promise<MessageSendError> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(MessageSendError);
  return err as MessageSendError;
}

describe("WhatsApp Cloud client", () => {
  const cfg = { accessToken: "tok", phoneNumberId: "999", apiVersion: "v21.0" };
  it("sends a template and returns Meta's message id", async () => {
    const f = fetchReturning(200, { messages: [{ id: "wamid.abc" }] });
    const client = new WhatsAppCloudClient(cfg, logger, f.impl);
    const res = await client.sendTemplate("+447700900123", { name: "hello_world", language: "en_US", components: [] });
    expect(res).toEqual({ messageId: "wamid.abc" });
    expect(JSON.parse(String(f.calls[0]!.init.body))).toMatchObject({ to: "447700900123", type: "template", template: { name: "hello_world", language: { code: "en_US" } } });
  });
  it("retries rate limits, server errors and network errors, not bad requests", async () => {
    const send = (impl: typeof fetch) => new WhatsAppCloudClient(cfg, logger, impl).sendTemplate("+91", { name: "x", language: "en", components: [] });
    expect((await rejection(send(fetchReturning(429, "{}").impl))).retryable).toBe(true);
    expect((await rejection(send(fetchReturning(503, "{}").impl))).retryable).toBe(true);
    expect((await rejection(send(fetchReturning(400, "{}").impl))).retryable).toBe(false);
    expect((await rejection(send((async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch))).retryable).toBe(true);
  });
});

describe("MSG91 flow client", () => {
  it("posts the flow with the recipient's variables", async () => {
    const f = fetchReturning(200, { type: "success", message: "req-1" });
    const res = await new Msg91FlowClient({ authKey: "key" }, logger, f.impl).send("+919876543210", "flow-1", { name: "Asha" });
    expect(res).toEqual({ requestId: "req-1" });
    expect(f.calls[0]!.url).toBe("https://control.msg91.com/api/v5/flow");
    expect(f.calls[0]!.init.headers).toMatchObject({ authkey: "key" });
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ template_id: "flow-1", short_url: "0", recipients: [{ mobiles: "919876543210", name: "Asha" }] });
  });
  it("treats an error body as a failure even with HTTP 200", async () => {
    const err = await rejection(new Msg91FlowClient({ authKey: "key" }, logger, fetchReturning(200, { type: "error", message: "Invalid template" }).impl).send("+91", "f", {}));
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("Invalid template");
  });
});

describe("SMTP email sender", () => {
  it("builds the email from the configured sender", async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const raw: string[] = [];
    const capturing = {
      sendMail: async (opts: Parameters<typeof transport.sendMail>[0]) => {
        const info = (await transport.sendMail(opts)) as unknown as { message: Buffer; messageId: string };
        raw.push(info.message.toString());
        return info as never;
      },
    };
    const sender = new SmtpEmailSender(capturing, "Illuminize <no-reply@illuminize.test>", "alumni@illuminize.test");
    const res = await sender.send({ channel: "EMAIL", to: "asha@example.com", toName: "Asha Rao", subject: "Hello", text: "Plain body", html: "<p>Plain body</p>" });
    expect(res.providerMessageId).toMatch(/@/);
    expect(raw[0]).toContain("From: Illuminize <no-reply@illuminize.test>");
    expect(raw[0]).toContain("To: Asha Rao <asha@example.com>");
    expect(raw[0]).toContain("Reply-To: alumni@illuminize.test");
    expect(raw[0]).toContain("Subject: Hello");
    expect(raw[0]).toContain("Plain body");
  });
  it("passes extra headers such as List-Unsubscribe", async () => {
    const raw: string[] = [];
    const capturing = {
      sendMail: async (opts: { headers?: Record<string, string> }) => {
        raw.push(JSON.stringify(opts.headers ?? {}));
        return { messageId: "<id@test>" };
      },
    };
    const sender = new SmtpEmailSender(capturing as never, "a@b.c");
    await sender.send({ channel: "EMAIL", to: "x@y.z", subject: "s", text: "t", headers: { "List-Unsubscribe": "<https://x/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
    expect(JSON.parse(raw[0]!)).toEqual({ "List-Unsubscribe": "<https://x/u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  });
  it("retries temporary SMTP replies and connection problems, not permanent ones", async () => {
    const failing = (error: object) => new SmtpEmailSender({ sendMail: async () => Promise.reject(Object.assign(new Error("smtp"), error)) }, "a@b.c");
    const m = { channel: "EMAIL" as const, to: "x@y.z", subject: "s", text: "t" };
    expect((await rejection(failing({ responseCode: 451 }).send(m))).retryable).toBe(true);
    expect((await rejection(failing({ responseCode: 550 }).send(m))).retryable).toBe(false);
    expect((await rejection(failing({ code: "ECONNECTION" }).send(m))).retryable).toBe(true);
    expect((await rejection(failing({ code: "EAUTH" }).send(m))).retryable).toBe(false);
  });
});

describe("message templates", () => {
  it("renders the email confirmation with no member-supplied text and escapes the link", () => {
    const r = renderForChannel("EMAIL_VERIFY", "EMAIL", { verificationId: "v1", link: 'https://app.test/verify-email?token=a"b' }, { phone: null, email: "a@b.c", name: "<b>Eve</b>" }, {});
    expect("message" in r && r.message.channel === "EMAIL").toBe(true);
    if (!("message" in r) || r.message.channel !== "EMAIL") return;
    expect(r.message.subject).toBe("Confirm your email address");
    expect(r.message.text).toContain('https://app.test/verify-email?token=a"b');
    expect(r.message.html).toContain("token=a&quot;b");
    expect(r.message.html).not.toContain("Eve");
    expect(renderForChannel("EMAIL_VERIFY", "WHATSAPP", { verificationId: "v1", link: "x" }, { phone: "+91", email: null, name: null }, {})).toEqual({ skip: "no WhatsApp template" });
  });
  const to = { phone: "+919876543210", email: "asha@example.com", name: "Asha" };
  it("renders each channel of the platform test message", () => {
    expect(renderForChannel("PLATFORM_TEST", "WHATSAPP", { sentBy: "Staff" }, to, {})).toEqual({ message: { channel: "WHATSAPP", to: to.phone, template: { name: "hello_world", language: "en_US", components: [] } } });
    const email = renderForChannel("PLATFORM_TEST", "EMAIL", { sentBy: "Staff <x>", recipientName: "Asha" }, to, {});
    expect(email).toMatchObject({ message: { channel: "EMAIL", to: to.email, subject: "Illuminize test message" } });
    expect("message" in email && email.message.channel === "EMAIL" && email.message.html).toContain("Staff &lt;x&gt;");
  });
  it("skips channels without an address or an SMS flow id", () => {
    expect(renderForChannel("PLATFORM_TEST", "SMS", { sentBy: "S" }, to, {})).toEqual({ skip: "no MSG91 flow template id for PLATFORM_TEST" });
    expect(renderForChannel("PLATFORM_TEST", "SMS", { sentBy: "S" }, to, { PLATFORM_TEST: "flow-9" })).toMatchObject({ message: { flowTemplateId: "flow-9", vars: { name: "there" } } });
    expect(renderForChannel("PLATFORM_TEST", "EMAIL", { sentBy: "S" }, { ...to, email: null }, {})).toEqual({ skip: "no email address" });
  });
});
