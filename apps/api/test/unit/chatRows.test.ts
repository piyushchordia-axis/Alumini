import type { ChatMessageDto } from "@illuminize/shared";
import { groupMessages, threadItems, type ChatMessagePages, type ChatRow, type OutboxEntry, type ThreadItem } from "@illuminize/shared/chat";
import { describe, expect, it } from "vitest";

const ME = "m-me";
const THEM = "m-them";
const OPTIONS = { timeZone: "UTC", locale: "en-GB" };
const NOW = new Date("2026-06-15T12:00:00.000Z");

let seq = 0;
function msg(sender: string | null, at: string, overrides: Partial<ChatMessageDto> = {}): ThreadItem {
  seq += 1;
  const message: ChatMessageDto = { id: `id-${seq}`, conversationId: "c1", seq, kind: "TEXT", sender: sender ? { id: sender, fullName: sender, avatarUrl: null } : null, body: "Text", removed: false, meta: null, clientKey: null, createdAt: at, ...overrides };
  return { key: message.clientKey ?? message.id, message, pending: null };
}
const pending = (at: string, clientKey = "k1"): ThreadItem => {
  const entry: OutboxEntry = { clientKey, conversationId: "c1", body: "Sending", status: "sending", createdAt: at };
  return { key: clientKey, message: null, pending: entry };
};
const messages = (rows: ChatRow[]) => rows.filter((r): r is Extract<ChatRow, { type: "message" }> => r.type === "message");
const days = (rows: ChatRow[]) => rows.filter((r): r is Extract<ChatRow, { type: "day" }> => r.type === "day").map((r) => r.label);
const shape = (rows: ChatRow[]) => messages(rows).map((r) => [r.startsGroup, r.endsGroup]);

describe("groupMessages", () => {
  it("runs nothing into nothing", () => {
    expect(groupMessages([], ME, NOW, OPTIONS)).toEqual([]);
  });

  it("marks a lone message as both the start and the end of its run", () => {
    expect(shape(groupMessages([msg(THEM, "2026-06-15T10:00:00.000Z")], ME, NOW, OPTIONS))).toEqual([[true, true]]);
  });

  it("runs messages from one sender together when they're within five minutes", () => {
    const rows = groupMessages([msg(THEM, "2026-06-15T10:00:00.000Z"), msg(THEM, "2026-06-15T10:04:59.000Z"), msg(THEM, "2026-06-15T10:09:59.000Z")], ME, NOW, OPTIONS);
    expect(shape(rows)).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
  });

  it("breaks a run after five minutes, measured from the message before", () => {
    const rows = groupMessages([msg(THEM, "2026-06-15T10:00:00.000Z"), msg(THEM, "2026-06-15T10:05:01.000Z")], ME, NOW, OPTIONS);
    expect(shape(rows)).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it("breaks a run when the sender changes", () => {
    const rows = groupMessages([msg(THEM, "2026-06-15T10:00:00.000Z"), msg(ME, "2026-06-15T10:00:30.000Z"), msg(THEM, "2026-06-15T10:01:00.000Z")], ME, NOW, OPTIONS);
    expect(shape(rows)).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
    expect(messages(rows).map((r) => r.mine)).toEqual([false, true, false]);
  });

  it("breaks a run at midnight even inside five minutes, in the viewer's zone", () => {
    const items = [msg(THEM, "2026-06-14T18:29:00.000Z"), msg(THEM, "2026-06-14T18:31:00.000Z")];
    const inKolkata = groupMessages(items, ME, NOW, { timeZone: "Asia/Kolkata", locale: "en-GB" });
    expect(days(inKolkata)).toHaveLength(2);
    expect(shape(inKolkata)).toEqual([
      [true, true],
      [true, true],
    ]);
    const inUtc = groupMessages(items, ME, NOW, OPTIONS);
    expect(days(inUtc)).toHaveLength(1);
    expect(shape(inUtc)).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("keeps system messages and a deleted member's messages out of any run", () => {
    const rows = groupMessages(
      [msg(THEM, "2026-06-15T10:00:00.000Z"), msg(null, "2026-06-15T10:00:10.000Z", { kind: "SYSTEM" }), msg(THEM, "2026-06-15T10:00:20.000Z"), msg(null, "2026-06-15T10:00:30.000Z"), msg(null, "2026-06-15T10:00:40.000Z")],
      ME,
      NOW,
      OPTIONS,
    );
    expect(shape(rows).every(([starts, ends]) => starts && ends)).toBe(true);
    expect(messages(rows).map((r) => r.mine)).toEqual([false, false, false, false, false]);
  });

  it("treats a send still in the outbox as mine, in my run", () => {
    const rows = groupMessages([msg(ME, "2026-06-15T10:00:00.000Z"), pending("2026-06-15T10:00:30.000Z")], ME, NOW, OPTIONS);
    expect(messages(rows).map((r) => r.mine)).toEqual([true, true]);
    expect(shape(rows)).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(messages(rows)[1]!.key).toBe("k1");
  });

  it("keeps a removed message's place in a run", () => {
    const rows = groupMessages([msg(THEM, "2026-06-15T10:00:00.000Z"), msg(THEM, "2026-06-15T10:00:30.000Z", { body: null, removed: true })], ME, NOW, OPTIONS);
    expect(shape(rows)).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("labels days as Today, Yesterday, a date, and a date with the year once it's a different year", () => {
    const items = [msg(THEM, "2025-12-31T10:00:00.000Z"), msg(THEM, "2026-06-01T10:00:00.000Z"), msg(THEM, "2026-06-14T10:00:00.000Z"), msg(THEM, "2026-06-15T10:00:00.000Z")];
    expect(days(groupMessages(items, ME, NOW, OPTIONS))).toEqual(["31 Dec 2025", "1 Jun", "Yesterday", "Today"]);
  });

  it("shows a day label only when the day changes, ahead of its first message", () => {
    const rows = groupMessages([msg(THEM, "2026-06-14T10:00:00.000Z"), msg(THEM, "2026-06-14T11:00:00.000Z"), msg(THEM, "2026-06-15T10:00:00.000Z")], ME, NOW, OPTIONS);
    expect(rows.map((r) => r.type)).toEqual(["day", "message", "message", "day", "message"]);
  });

  it("works out Today in the viewer's zone, not the server's", () => {
    const lateEvening = new Date("2026-06-15T20:00:00.000Z");
    const items = [msg(THEM, "2026-06-15T19:00:00.000Z")];
    expect(days(groupMessages(items, ME, lateEvening, { timeZone: "Asia/Kolkata", locale: "en-GB" }))).toEqual(["Today"]);
    expect(days(groupMessages(items, ME, new Date("2026-06-16T19:00:00.000Z"), { timeZone: "Asia/Kolkata", locale: "en-GB" }))).toEqual(["Yesterday"]);
  });

  it("formats the time for the viewer", () => {
    const rows = groupMessages([msg(THEM, "2026-06-15T10:05:00.000Z")], ME, NOW, { timeZone: "Asia/Kolkata", locale: "en-GB" });
    expect(messages(rows)[0]!.timeLabel).toBe("15:35");
  });

  it("gives every row a stable, unique key", () => {
    const rows = groupMessages([msg(THEM, "2026-06-14T10:00:00.000Z"), msg(THEM, "2026-06-15T10:00:00.000Z"), pending("2026-06-15T10:00:30.000Z")], ME, NOW, OPTIONS);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it("keeps keys unique when a send that failed yesterday sits after today's messages", () => {
    const yesterday = msg(THEM, "2026-06-14T22:00:00.000Z");
    const failed: OutboxEntry = { clientKey: "k-failed", conversationId: "c1", body: "Didn't go", status: "failed", createdAt: "2026-06-14T23:50:00.000Z" };
    const data: ChatMessagePages = { pages: [{ data: [{ ...(msg(THEM, "2026-06-15T09:00:00.000Z").message as ChatMessageDto), seq: 2 }, { ...(yesterday.message as ChatMessageDto), seq: 1 }], nextCursor: null }], pageParams: [undefined] };
    const rows = groupMessages(threadItems(data, [failed]), ME, NOW, OPTIONS);
    // The failed one stays last, where Try again is in view, under its own day's label.
    expect(rows.map((r) => (r.type === "day" ? r.label : r.key))).toEqual(["Yesterday", expect.any(String), "Today", expect.any(String), "Yesterday", "k-failed"]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    // The first label of a day keeps its plain key, so it isn't remounted when older pages load in above it.
    expect(rows.filter((r) => r.type === "day").map((r) => r.key)).toEqual([expect.stringMatching(/^day-\d+$/), expect.stringMatching(/^day-\d+$/), expect.stringMatching(/^day-\d+-2$/)]);
  });

  it("takes what threadItems gives it", () => {
    const data: ChatMessagePages = { pages: [{ data: [{ ...(msg(ME, "2026-06-15T10:00:30.000Z").message as ChatMessageDto), seq: 2 }, { ...(msg(THEM, "2026-06-15T10:00:00.000Z").message as ChatMessageDto), seq: 1 }], nextCursor: null }], pageParams: [undefined] };
    const rows = groupMessages(threadItems(data, []), ME, NOW, OPTIONS);
    expect(messages(rows).map((r) => r.mine)).toEqual([false, true]);
  });
});
