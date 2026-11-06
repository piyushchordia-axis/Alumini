import { MESSAGE_CHANNELS, announcementChannelLabel, announcementConfirmCopy, announcementReachText, postCreatedText, type AnnouncementAudienceDto } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const audience: AnnouncementAudienceDto = { members: 1240, withEmail: 812, withPhone: 1203, channels: ["EMAIL", "WHATSAPP", "SMS"] };
const BILLED = "Messages are billed to your institution.";

describe("announcementConfirmCopy", () => {
  it("asks nothing when no billed channel is chosen", () => {
    expect(announcementConfirmCopy(audience, [])).toBeNull();
    expect(announcementConfirmCopy(undefined, [])).toBeNull();
  });

  it("names the channel, how many it reaches and who pays", () => {
    expect(announcementConfirmCopy(audience, ["EMAIL"])).toEqual({
      title: "Send this announcement by email?",
      body: `It goes by email to 812 members. ${BILLED}`,
      confirm: "Post and send",
    });
  });

  it("counts a phone channel as reaching every member and email alone only those with a confirmed one", () => {
    expect(announcementConfirmCopy(audience, ["WHATSAPP"])?.body).toBe(`It goes by WhatsApp to 1,203 members. ${BILLED}`);
    expect(announcementConfirmCopy(audience, ["SMS"])?.body).toBe(`It goes by SMS to 1,203 members. ${BILLED}`);
  });

  // announcements.service gives each member one message with the chosen channels as a chain, in MESSAGE_CHANNELS
  // order, and the sender stops at the first that works: several channels are fallbacks, never a message each.
  it("says several channels send one message to each member, tried in the order the send uses whatever order they were ticked in", () => {
    expect(MESSAGE_CHANNELS).toEqual(["WHATSAPP", "SMS", "EMAIL"]);
    const copy = announcementConfirmCopy(audience, ["EMAIL", "SMS", "WHATSAPP"]);
    expect(copy).toEqual({
      title: "Send this announcement by WhatsApp, SMS or email?",
      body: `It goes to 1,203 members, one message each: by WhatsApp, or when that can't be sent, by SMS, then email. ${BILLED}`,
      confirm: "Post and send",
    });
    expect(announcementConfirmCopy(audience, ["SMS", "WHATSAPP", "EMAIL"])).toEqual(copy);
    // Email after a phone channel only stands in for it, so it adds nobody to the count.
    expect(announcementConfirmCopy(audience, ["EMAIL", "WHATSAPP"])).toEqual({
      title: "Send this announcement by WhatsApp or email?",
      body: `It goes to 1,203 members, one message each: by WhatsApp, or when that can't be sent, by email. ${BILLED}`,
      confirm: "Post and send",
    });
    expect(announcementConfirmCopy(audience, ["SMS", "EMAIL"])?.body).toBe(`It goes to 1,203 members, one message each: by SMS, or when that can't be sent, by email. ${BILLED}`);
  });

  it("says one member, and still names the order and the bill before the audience has loaded", () => {
    expect(announcementConfirmCopy({ ...audience, withPhone: 1 }, ["SMS"])?.body).toBe(`It goes by SMS to 1 member. ${BILLED}`);
    expect(announcementConfirmCopy({ ...audience, withPhone: 1 }, ["WHATSAPP", "EMAIL"])?.body).toBe(`It goes to 1 member, in one message: by WhatsApp, or when that can't be sent, by email. ${BILLED}`);
    expect(announcementConfirmCopy(undefined, ["EMAIL"])).toEqual({ title: "Send this announcement by email?", body: `It goes by email. ${BILLED}`, confirm: "Post and send" });
    expect(announcementConfirmCopy(undefined, ["WHATSAPP", "EMAIL"])).toEqual({
      title: "Send this announcement by WhatsApp or email?",
      body: `It goes to each member once: by WhatsApp, or when that can't be sent, by email. ${BILLED}`,
      confirm: "Post and send",
    });
  });
});

describe("the composer's Announce panel", () => {
  it("says who gets it in the app, with the count once it's known", () => {
    expect(announcementReachText(undefined)).toBe("Every member gets it in the app and as a push notification.");
    expect(announcementReachText(audience)).toBe("Every member (1,240) gets it in the app and as a push notification.");
  });

  it("labels each channel with how many it reaches", () => {
    expect(announcementChannelLabel("EMAIL", audience)).toBe("Also email it (812 members with a confirmed email)");
    expect(announcementChannelLabel("WHATSAPP", audience)).toBe("Also send by WhatsApp (1,203 members)");
    expect(announcementChannelLabel("SMS", { ...audience, withPhone: 1 })).toBe("Also send by SMS (1 member)");
  });
});

describe("postCreatedText", () => {
  it("says an announcement is on its way, and a post whether it waits for approval", () => {
    expect(postCreatedText({ kind: "ANNOUNCEMENT", moderationStatus: "APPROVED" })).toBe("Announcement posted; members are being notified");
    expect(postCreatedText({ kind: "POST", moderationStatus: "PENDING" })).toBe("Posted — awaiting admin approval");
    expect(postCreatedText({ kind: "POST", moderationStatus: "APPROVED" })).toBe("Posted!");
  });
});
