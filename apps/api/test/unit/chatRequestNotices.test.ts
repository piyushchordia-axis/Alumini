import { ERROR_CODES } from "@illuminize/shared";
import { sendLimitNotice } from "@illuminize/shared/chat";
import { describe, expect, it } from "vitest";

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
