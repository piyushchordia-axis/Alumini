import { activeChat, focusScope, focusThread, NO_CHAT_FOCUS, unfocusThread, type ChatFocus } from "@illuminize/shared/chat";
import { describe, expect, it } from "vitest";

/**
 * React runs a child's effects before its parent's, so when the member layout and a thread mount in one commit (a reload, a
 * pasted link, a push that cold-starts the app), the thread says it's open before the layout says which institution is on
 * screen. These replay the orders the apps' effects run in.
 */
describe("chat focus", () => {
  const run = (...steps: Array<(f: ChatFocus) => ChatFocus>) => steps.reduce((f, step) => step(f), NO_CHAT_FOCUS);
  const scope = (slug: string | null) => (f: ChatFocus) => focusScope(f, slug);
  const open = (slug: string, id: string) => (f: ChatFocus) => focusThread(f, slug, id);
  const close = (slug: string, id: string) => (f: ChatFocus) => unfocusThread(f, slug, id);

  it("keeps a thread that mounted with its layout, child effect first", () => {
    expect(activeChat(run(open("demo", "c1"), scope("demo")))).toEqual({ slug: "demo", conversationId: "c1" });
  });

  it("keeps it when the layout's scope effect re-runs, its cleanup going to null and back", () => {
    expect(activeChat(run(scope("demo"), open("demo", "c1"), scope(null), scope("demo")))).toEqual({ slug: "demo", conversationId: "c1" });
  });

  it("is nothing until an institution is on screen", () => {
    expect(activeChat(run(open("demo", "c1")))).toBeNull();
    expect(activeChat(run(scope("demo"), open("demo", "c1"), scope(null)))).toBeNull();
  });

  it("never reports one institution's thread as open in another", () => {
    expect(activeChat(run(scope("demo"), open("demo", "c1"), scope("other")))).toEqual({ slug: "other", conversationId: null });
  });

  it("clears only the thread that closes, whichever of two threads' effects runs first", () => {
    // The next thread opened before the last one's cleanup ran.
    expect(activeChat(run(scope("demo"), open("demo", "c1"), open("demo", "c2"), close("demo", "c1")))).toEqual({ slug: "demo", conversationId: "c2" });
    expect(activeChat(run(scope("demo"), open("demo", "c1"), close("demo", "c1"), open("demo", "c2")))).toEqual({ slug: "demo", conversationId: "c2" });
    expect(activeChat(run(scope("demo"), open("demo", "c1"), close("demo", "c1")))).toEqual({ slug: "demo", conversationId: null });
  });

  it("returns the same object when nothing changes, so a store doesn't wake its subscribers", () => {
    const f = run(scope("demo"), open("demo", "c1"));
    expect(focusScope(f, "demo")).toBe(f);
    expect(focusThread(f, "demo", "c1")).toBe(f);
    expect(unfocusThread(f, "demo", "c2")).toBe(f);
  });
});
