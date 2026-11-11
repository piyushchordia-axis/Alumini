import { CHAT_ATTACHMENT_LINKS_PER_CALL, type ChatAttachmentLinksDto } from "@illuminize/shared";
import { createAttachmentLinkLoader } from "@illuminize/shared/chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EXPIRES = "2026-11-07T12:10:00.000Z";
const link = (messageId: string, id: string) => ({ id, messageId, url: `https://files.test/${id}`, thumbUrl: `https://files.test/${id}/thumb`, downloadUrl: `https://files.test/${id}/download` });

/** A fake API that answers with one link per message asked for, except those in `hidden`, and records each call. */
function fakeApi(hidden: string[] = []) {
  const calls: Array<{ slug: string; conversationId: string; messageIds: string[] }> = [];
  const fetchLinks = vi.fn(async (slug: string, conversationId: string, messageIds: readonly string[]): Promise<ChatAttachmentLinksDto> => {
    calls.push({ slug, conversationId, messageIds: [...messageIds] });
    return { expiresAt: EXPIRES, links: messageIds.filter((m) => !hidden.includes(m)).map((m) => link(m, `${m}-a`)) };
  });
  return { calls, fetchLinks };
}

describe("createAttachmentLinkLoader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks once for every message that wants links at the same moment, and gives each its own", async () => {
    const { calls, fetchLinks } = fakeApi();
    const loader = createAttachmentLinkLoader(fetchLinks);
    const loads = ["m1", "m2", "m3"].map((m) => loader.load("demo", "c1", m));
    await vi.runAllTimersAsync();
    const answers = await Promise.all(loads);
    expect(calls).toEqual([{ slug: "demo", conversationId: "c1", messageIds: ["m1", "m2", "m3"] }]);
    expect(answers.map((a) => a.links.map((l) => l.id))).toEqual([["m1-a"], ["m2-a"], ["m3-a"]]);
    expect(answers.every((a) => a.expiresAt === EXPIRES)).toBe(true);
  });

  it("asks once for a message wanted twice, and separately for each conversation", async () => {
    const { calls, fetchLinks } = fakeApi();
    const loader = createAttachmentLinkLoader(fetchLinks);
    const [a, b, c] = [loader.load("demo", "c1", "m1"), loader.load("demo", "c1", "m1"), loader.load("demo", "c2", "m9")];
    await vi.runAllTimersAsync();
    expect((await a).links).toEqual((await b).links);
    expect((await c).links.map((l) => l.id)).toEqual(["m9-a"]);
    expect(calls).toEqual([
      { slug: "demo", conversationId: "c1", messageIds: ["m1"] },
      { slug: "demo", conversationId: "c2", messageIds: ["m9"] },
    ]);
  });

  it("splits a batch at the most one call may name", async () => {
    const { calls, fetchLinks } = fakeApi();
    const loader = createAttachmentLinkLoader(fetchLinks);
    const ids = Array.from({ length: CHAT_ATTACHMENT_LINKS_PER_CALL + 3 }, (_, i) => `m${i}`);
    const loads = ids.map((m) => loader.load("demo", "c1", m));
    await vi.runAllTimersAsync();
    await Promise.all(loads);
    expect(calls.map((c) => c.messageIds.length)).toEqual([CHAT_ATTACHMENT_LINKS_PER_CALL, 3]);
  });

  it("starts a new batch for anything asked after the last one went", async () => {
    const { calls, fetchLinks } = fakeApi();
    const loader = createAttachmentLinkLoader(fetchLinks);
    const first = loader.load("demo", "c1", "m1");
    await vi.runAllTimersAsync();
    await first;
    const second = loader.load("demo", "c1", "m2");
    await vi.runAllTimersAsync();
    await second;
    expect(calls.map((c) => c.messageIds)).toEqual([["m1"], ["m2"]]);
  });

  it("gives a message the member may no longer see no links, rather than failing the others", async () => {
    const { fetchLinks } = fakeApi(["m2"]);
    const loader = createAttachmentLinkLoader(fetchLinks);
    const loads = [loader.load("demo", "c1", "m1"), loader.load("demo", "c1", "m2")];
    await vi.runAllTimersAsync();
    const [one, two] = await Promise.all(loads);
    expect(one!.links).toHaveLength(1);
    expect(two).toEqual({ expiresAt: EXPIRES, links: [] });
  });

  it("fails every message of a request that failed, including one that threw before answering", async () => {
    const loader = createAttachmentLinkLoader(async () => Promise.reject(new Error("offline")));
    const loads = [loader.load("demo", "c1", "m1"), loader.load("demo", "c1", "m2")].map((p) => p.then(() => "ok", (e: Error) => e.message));
    await vi.runAllTimersAsync();
    expect(await Promise.all(loads)).toEqual(["offline", "offline"]);

    const throwing = createAttachmentLinkLoader(() => {
      throw new Error("bad call");
    });
    const load = throwing.load("demo", "c1", "m1").then(() => "ok", (e: Error) => e.message);
    await vi.runAllTimersAsync();
    expect(await load).toBe("bad call");
  });
});
