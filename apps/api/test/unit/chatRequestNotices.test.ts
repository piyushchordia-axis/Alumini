import type { ChatConversationDto, ChatGroupReviewDto } from "@illuminize/shared";
import { ERROR_CODES } from "@illuminize/shared";
import { formatRerequestAt, REREQUEST_RECHECK_MS, rerequestDrawAt, rerequestOpenedText, rerequestRefetchIn, sendLimitNotice, threadFooter, watchRerequest, type ThreadFooter } from "@illuminize/shared/chat";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("sendLimitNotice", () => {
  it("tells the member's own limit apart from a busy group's", () => {
    // The web and phone e2e journeys look for the first one whole on the screen writing a first message, and the web one
    // for its opening words in a thread too. Neither reaches the second.
    expect(sendLimitNotice("RATE_LIMITED")).toBe("You're sending messages quickly. Wait a moment, then send again.");
    expect(sendLimitNotice("CHAT_GROUP_BUSY")).toBe("This group is very busy right now. Try again in a moment.");
  });

  it("leaves every other failure to the caller, which shows the error's own message", () => {
    for (const code of ERROR_CODES.filter((c) => c !== "RATE_LIMITED" && c !== "CHAT_GROUP_BUSY")) expect(sendLimitNotice(code), code).toBeNull();
    expect(sendLimitNotice("NETWORK_ERROR")).toBeNull();
    // A failure that isn't the API's, such as a thrown TypeError, comes with no code at all.
    expect(sendLimitNotice(null)).toBeNull();
    expect(sendLimitNotice(undefined)).toBeNull();
  });
});

// Local times, so the days hold in any time zone the tests run in.
const NOW = new Date(2026, 10, 7, 9, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const later = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const time = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const weekday = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(iso));

type Thread = Pick<ChatConversationDto, "group" | "peer" | "blockedByMe" | "state" | "canSend" | "canRerequestAt">;
const peer = { id: "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81", fullName: "Priya Sharma", avatarUrl: null, startYear: 2010, batchYear: 2014 };
const direct = (over: Partial<Thread> = {}): Thread => ({ group: null, peer, blockedByMe: false, state: "REQUEST_SENT", canSend: false, canRerequestAt: later(20 * DAY), ...over });
const groupThread = (over: Partial<NonNullable<Thread["group"]>> = {}, canSend = false): Thread => ({
  group: { name: "Weekend runners", visibility: "OPEN", memberCount: 3, archived: false, isOwner: true, ...over },
  peer: null,
  blockedByMe: false,
  state: "ACCEPTED",
  canSend,
  canRerequestAt: null,
});
const review = (moderationStatus: ChatGroupReviewDto["moderationStatus"]) => ({ review: { moderationStatus, moderationNote: null, moderatedAt: null, name: "Weekend runners", description: null, shownToMembers: false } });
const panel = (title: string, text: string, rest: Partial<Extract<ThreadFooter, { kind: "panel" }>> = {}): ThreadFooter => ({ kind: "panel", title, text, when: null, action: null, ...rest });

describe("threadFooter", () => {
  it("gives a group that can send the box with nothing above it, and says why one can't", () => {
    expect(threadFooter(groupThread({}, true), NOW)).toEqual({ kind: "composer", intro: null });
    expect(threadFooter(groupThread({ archived: true }), NOW, review("APPROVED"))).toEqual(panel("This group has been archived", "You can read it, but nobody can send messages in it any more."));
    expect(threadFooter(groupThread(), NOW, review("PENDING"))).toEqual(panel("Waiting for an admin to approve this group", "Nobody else can see it yet. Messages can be sent once it's approved."));
    expect(threadFooter(groupThread(), NOW, review("REJECTED"))).toEqual(
      panel("An admin didn't approve this group", "Members can't see it, and nobody can send messages in it. You can edit it from Group details and send it for review again."),
    );
    expect(threadFooter(groupThread(), NOW, review("REMOVED"))).toEqual(panel("An admin removed this group", "Members can't see it, and nobody can send messages in it."));
    // An approved group, its details not loaded yet, or none to say: the plain words.
    const plain = panel("You can't send messages here right now", "You can still read the conversation.");
    expect(threadFooter(groupThread(), NOW, review("APPROVED"))).toEqual(plain);
    expect(threadFooter(groupThread(), NOW)).toEqual(plain);
    expect(threadFooter(groupThread(), NOW, { review: null })).toEqual(plain);
  });

  it("says when the other member has gone, or is blocked, before anything about the request", () => {
    expect(threadFooter(direct({ peer: null }), NOW)).toEqual(panel("This member deleted their account", "You can read the conversation, but not reply."));
    expect(threadFooter(direct({ blockedByMe: true }), NOW)).toEqual(panel("You blocked Priya Sharma", "Unblock them to send messages. Anything they sent while blocked stays hidden.", { action: "UNBLOCK" }));
  });

  it("offers the recipient their answers, and the box once accepted", () => {
    expect(threadFooter(direct({ state: "REQUEST_RECEIVED", canSend: true, canRerequestAt: null }), NOW)).toEqual(
      panel("Priya Sharma wants to send you a message", "Accept to reply. If you decline, they won't be told.", { action: "ANSWER_REQUEST" }),
    );
    expect(threadFooter(direct({ state: "REQUEST_DECLINED", canSend: true, canRerequestAt: null }), NOW)).toEqual(panel("You declined this request", "Priya Sharma hasn't been told.", { action: "ACCEPT_DECLINED" }));
    expect(threadFooter(direct({ state: "ACCEPTED", canSend: true, canRerequestAt: null }), NOW)).toEqual({ kind: "composer", intro: null });
    expect(threadFooter(direct({ state: "ACCEPTED", canSend: false, canRerequestAt: null }), NOW)).toEqual(panel("You can't message Priya Sharma right now", "You can still read the conversation."));
  });

  it("gives a request waiting the date to ask again on a line of its own, while it's still to come", () => {
    const at = later(20 * DAY);
    expect(threadFooter(direct({ canRerequestAt: at }), NOW)).toEqual(
      panel("Request sent", "You can send more once Priya Sharma accepts.", { when: { lead: "You can ask again from ", at: formatRerequestAt(at, NOW), tail: " if they haven't accepted by then.", iso: at } }),
    );
    // Its requests used up, or the date gone by while the answer still can't send (a clock ahead of the server's): no line.
    for (const canRerequestAt of [null, later(-1000), NOW.toISOString()]) expect(threadFooter(direct({ canRerequestAt }), NOW)).toEqual(panel("Request sent", "You can send more once Priya Sharma accepts."));
    expect(threadFooter(direct({ canSend: true, canRerequestAt: later(-DAY) }), NOW)).toEqual({ kind: "composer", intro: "Your next message asks Priya Sharma again, as a new request." });
  });

  it("gives a closed thread the date it can be asked again from, or says it's read-only once its requests are used up", () => {
    const at = later(HOUR);
    expect(threadFooter(direct({ state: "CLOSED", canRerequestAt: at }), NOW)).toEqual(
      panel("This conversation has closed", "You can still read it.", { when: { lead: "You can send a new request from ", at: `${time(at)} today`, tail: ".", iso: at } }),
    );
    expect(threadFooter(direct({ state: "CLOSED", canRerequestAt: null }), NOW)).toEqual(panel("This conversation has closed", "You can read it, but not reply."));
    // The date gone by while the answer still can't send, as the box is about to come back (or with a clock ahead of the
    // server's): the line goes, and nothing says it can't be asked again.
    for (const canRerequestAt of [later(-HOUR), NOW.toISOString()]) expect(threadFooter(direct({ state: "CLOSED", canRerequestAt }), NOW)).toEqual(panel("This conversation has closed", "You can still read it."));
    expect(threadFooter(direct({ state: "CLOSED", canSend: true, canRerequestAt: later(-HOUR) }), NOW)).toEqual({
      kind: "composer",
      intro: "This conversation has closed. Sending a message asks Priya Sharma to chat again.",
    });
  });

  it("hides the date's line once the time it's drawn at passes it", () => {
    const c = direct({ canRerequestAt: later(5 * 60_000) });
    expect(threadFooter(c, NOW)).toMatchObject({ when: { iso: c.canRerequestAt } });
    expect(threadFooter(c, new Date(NOW.getTime() + 5 * 60_000 + 1000))).toMatchObject({ when: null });
  });

  it("never hints at a decline or a block in anything a requester reads", () => {
    const said: unknown[] = [];
    for (const state of ["REQUEST_SENT", "CLOSED"] as const) {
      for (const canRerequestAt of [later(HOUR), later(DAY + HOUR), later(40 * DAY), later(400 * DAY), later(-HOUR), null]) {
        for (const canSend of [true, false]) said.push(threadFooter(direct({ state, canSend, canRerequestAt }), NOW));
      }
      said.push(rerequestOpenedText(direct({ state })));
    }
    expect(JSON.stringify(said)).not.toMatch(/declin|block|reject|ignor|refus|turned down|unavailable/i);
  });
});

describe("formatRerequestAt", () => {
  it("gives the time on the day itself and the next, and the day and date after that", () => {
    const today = new Date(2026, 10, 7, 18, 40).toISOString();
    const tomorrow = new Date(2026, 10, 8, 7, 5).toISOString();
    expect(formatRerequestAt(today, NOW)).toBe(`${time(today)} today`);
    expect(formatRerequestAt(tomorrow, NOW)).toBe(`${time(tomorrow)} tomorrow`);
    const december = new Date(2026, 11, 4, 18, 40).toISOString();
    const shown = formatRerequestAt(december, NOW);
    expect(shown).toBe(`${weekday(december)}, ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(december))}`);
    expect(shown).toMatch(/4/);
    expect(shown).not.toMatch(/2026|today|tomorrow|:/);
  });

  it("adds the year when it isn't this one", () => {
    const january = new Date(2027, 0, 6, 9, 0).toISOString();
    expect(formatRerequestAt(january, NOW)).toBe(`${weekday(january)}, ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(january))}`);
    expect(formatRerequestAt(january, NOW)).toMatch(/2027/);
  });

  it("goes by the calendar day, not 24 hours", () => {
    const late = new Date(2026, 10, 7, 23, 30);
    const earlyNext = new Date(2026, 10, 8, 0, 30).toISOString();
    expect(formatRerequestAt(earlyNext, late)).toBe(`${time(earlyNext)} tomorrow`);
  });
});

describe("rerequestRefetchIn", () => {
  it("waits until a second after the date, while it's at most a day away", () => {
    expect(rerequestRefetchIn(direct({ canRerequestAt: later(5000) }), NOW)).toBe(6000);
    expect(rerequestRefetchIn(direct({ state: "CLOSED", canRerequestAt: later(DAY) }), NOW)).toBe(DAY + 1000);
  });

  it("waits for nothing a timer can't or needn't wait for", () => {
    const cases: Array<[string, Thread]> = [
      ["can send", direct({ canSend: true, canRerequestAt: later(HOUR) })],
      ["a group", { ...groupThread(), canRerequestAt: later(HOUR) }],
      ["no other member", direct({ peer: null, canRerequestAt: later(HOUR) })],
      // The requester's own block. One by the other member never reaches the DTO, so the timer runs alike for a request
      // waiting, declined or met by a block.
      ["blocked by me", direct({ blockedByMe: true, canRerequestAt: later(HOUR) })],
      ["no date", direct({ canRerequestAt: null })],
      ["more than a day away", direct({ canRerequestAt: later(DAY + 1) })],
      ["now", direct({ canRerequestAt: NOW.toISOString() })],
      ["gone by", direct({ canRerequestAt: later(-1000) })],
    ];
    for (const [what, c] of cases) expect(rerequestRefetchIn(c, NOW), what).toBeNull();
  });
});

describe("rerequestOpenedText", () => {
  it("says the box is back, for a request waiting and a closed thread only", () => {
    expect(rerequestOpenedText(direct())).toBe("You can ask Priya Sharma again now.");
    expect(rerequestOpenedText(direct({ state: "CLOSED" }))).toBe("You can send Priya Sharma a new request now.");
    for (const state of ["ACCEPTED", "REQUEST_RECEIVED", "REQUEST_DECLINED"] as const) expect(rerequestOpenedText(direct({ state })), state).toBeNull();
    expect(rerequestOpenedText(direct({ peer: null }))).toBeNull();
    expect(rerequestOpenedText(groupThread())).toBeNull();
  });
});

describe("rerequestDrawAt", () => {
  it("draws at the minute clock, or at the moment the date went by if that's later", () => {
    const passed = new Date(NOW.getTime() + 30_000);
    expect(rerequestDrawAt(NOW, null)).toBe(NOW);
    expect(rerequestDrawAt(NOW, passed)).toBe(passed);
    expect(rerequestDrawAt(passed, NOW)).toBe(passed);
  });
});

describe("watchRerequest", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A watch over thread `c`, at NOW on a fake clock. Each of its fetches gets the next of `answers` laid over `c`, which
   * goes back into the watch, as the screen drawing it would, before the fetch resolves. `hold` keeps the fetches waiting
   * until `release()`.
   */
  function setup(c: Thread, answers: Array<Partial<Thread>> = [], { hold = false } = {}) {
    // Back to NOW, with any earlier watch's timers gone.
    vi.useRealTimers();
    vi.useFakeTimers({ now: NOW });
    const announced: string[] = [];
    const passed: Date[] = [];
    let waiting: Array<() => void> = [];
    let fetches = 0;
    const refetch = vi.fn(async () => {
      const data = { ...c, ...answers[fetches++] } as ChatConversationDto;
      if (hold) await new Promise<void>((resolve) => waiting.push(resolve));
      watch.update(data, new Date());
      return { data };
    });
    const watch = watchRerequest({ refetch, announce: (text) => announced.push(text), passed: (at) => passed.push(at) });
    const release = async () => {
      waiting.forEach((resolve) => resolve());
      waiting = [];
      await vi.advanceTimersByTimeAsync(0);
    };
    return { watch, refetch, announced, passed, release };
  }
  const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
  const IN = 10 * 60_000;
  const at = (ms: number) => new Date(NOW.getTime() + ms);

  it("fetches a second after the date and says the box is back, once", async () => {
    const c = direct({ canRerequestAt: later(IN) });
    const { watch, refetch, announced, passed } = setup(c, [{ canSend: true }]);
    watch.update(c, NOW);
    await tick(IN + 999);
    expect(refetch).not.toHaveBeenCalled();
    await tick(1);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(passed).toEqual([at(IN + 1000)]);
    expect(announced).toEqual(["You can ask Priya Sharma again now."]);
    // The answer that can send stopped the second try.
    await tick(REREQUEST_RECHECK_MS * 2);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("says so for a closed thread too", async () => {
    const c = direct({ state: "CLOSED", canRerequestAt: later(IN) });
    const { watch, announced } = setup(c, [{ canSend: true }]);
    watch.update(c, NOW);
    await tick(IN + 1000);
    expect(announced).toEqual(["You can send Priya Sharma a new request now."]);
  });

  it("has the date's line go the moment it fires, before the minute clock gets there", async () => {
    const c = direct({ canRerequestAt: later(IN) });
    const { watch, passed } = setup(c, [{ canSend: false }]);
    watch.update(c, NOW);
    await tick(IN + 1000);
    // The minute clock last ticked before the date, so by it alone the date is still to come.
    const minuteClock = at(IN - 30_000);
    expect(threadFooter(c, minuteClock)).toMatchObject({ title: "Request sent", when: { iso: c.canRerequestAt } });
    expect(threadFooter(c, rerequestDrawAt(minuteClock, passed[0] ?? null))).toEqual(panel("Request sent", "You can send more once Priya Sharma accepts."));
  });

  it("tries once more 30 seconds on when the first answer still can't send, as with a clock ahead of the server's", async () => {
    const c = direct({ canRerequestAt: later(IN) });
    const { watch, refetch, announced } = setup(c, [{ canSend: false }, { canSend: true }]);
    watch.update(c, NOW);
    await tick(IN + 1000);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(announced).toEqual([]);
    await tick(REREQUEST_RECHECK_MS - 1);
    expect(refetch).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(announced).toEqual(["You can ask Priya Sharma again now."]);
  });

  it("stops after the second try, and the minute clock passing the date doesn't start it again", async () => {
    const c = direct({ canRerequestAt: later(IN) });
    const { watch, refetch, announced } = setup(c, [{ canSend: false }, { canSend: false }]);
    watch.update(c, NOW);
    await tick(IN + 1000 + REREQUEST_RECHECK_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
    watch.update(c, new Date());
    await tick(DAY);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(announced).toEqual([]);
  });

  it("waits until the date is a day away, and keeps its timer as the minute clock passes the date", async () => {
    const c = direct({ canRerequestAt: later(DAY + HOUR) });
    const { watch, refetch } = setup(c, [{ canSend: true }]);
    watch.update(c, NOW);
    // A minute before it's a day away: not yet, and nothing comes of waiting.
    await tick(HOUR - 60_000);
    watch.update(c, new Date());
    await tick(60_000);
    expect(refetch).not.toHaveBeenCalled();
    // The first minute within a day of it sets the timer.
    watch.update(c, new Date());
    // The minute clock ticks just past the date, half a second before the timer.
    await tick(DAY + 500);
    watch.update(c, new Date());
    expect(refetch).not.toHaveBeenCalled();
    await tick(500);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("moves its timer to a new date, and drops it for a thread that can send or whose date is over a day away", async () => {
    const c = direct({ canRerequestAt: later(IN) });
    const moved = setup(c, [{ canSend: true }]);
    moved.watch.update(c, NOW);
    moved.watch.update({ ...c, canRerequestAt: later(2 * IN) }, NOW);
    await tick(IN + 1000);
    expect(moved.refetch).not.toHaveBeenCalled();
    await tick(IN);
    expect(moved.refetch).toHaveBeenCalledTimes(1);

    for (const over of [{ canSend: true }, { canRerequestAt: later(2 * DAY) }, { canRerequestAt: null }]) {
      const dropped = setup(c);
      dropped.watch.update(c, NOW);
      dropped.watch.update({ ...c, ...over }, NOW);
      await tick(IN + 1000 + REREQUEST_RECHECK_MS);
      expect(dropped.refetch, JSON.stringify(over)).not.toHaveBeenCalled();
    }
  });

  it("does nothing once stopped, and says nothing of an answer that comes back after", async () => {
    const c = direct({ canRerequestAt: later(IN) });
    const early = setup(c, [{ canSend: true }]);
    early.watch.update(c, NOW);
    early.watch.stop();
    await tick(IN + 1000);
    expect(early.refetch).not.toHaveBeenCalled();

    const late = setup(c, [{ canSend: true }], { hold: true });
    late.watch.update(c, NOW);
    await tick(IN + 1000);
    expect(late.refetch).toHaveBeenCalledTimes(1);
    late.watch.stop();
    await late.release();
    expect(late.announced).toEqual([]);
    await tick(REREQUEST_RECHECK_MS);
    expect(late.refetch).toHaveBeenCalledTimes(1);
  });

  it("sets no timer for a thread with nothing to wait for", async () => {
    for (const c of [direct({ canSend: true, canRerequestAt: later(IN) }), direct({ blockedByMe: true, canRerequestAt: later(IN) }), direct({ peer: null, canRerequestAt: later(IN) }), direct({ canRerequestAt: null })]) {
      const { watch, refetch } = setup(c);
      watch.update(c, NOW);
      await tick(IN + 1000 + REREQUEST_RECHECK_MS);
      expect(refetch).not.toHaveBeenCalled();
    }
  });
});
