import { describe, expect, it } from "vitest";
import { toChatAttachmentDto, toChatLastMessageDto, toChatMessageDto } from "../../src/dto/chat.dto";
import type { ChatMessageRow, ChatSender } from "../../src/repositories/chat.repo";
import type { ChatAttachmentRow } from "../../src/repositories/chatAttachments.repo";

const AT = new Date("2026-11-07T10:00:00.000Z");
const SENDER: ChatSender = { id: "m-sender", fullName: "Asha Rao", avatarUrl: null, startYear: 2008, batchYear: 2012 };
const VIEWER = "m-viewer";

const message = (over: Partial<ChatMessageRow> = {}): ChatMessageRow => ({
  id: "msg-1",
  tenantId: "t-1",
  conversationId: "c-1",
  seq: 4,
  senderMembershipId: SENDER.id,
  kind: "TEXT",
  body: "See these",
  meta: null,
  clientKey: "key-1",
  withheld: false,
  removedAt: null,
  removedByUserId: null,
  removalNote: null,
  createdAt: AT,
  ...over,
});

const PHOTO: ChatAttachmentRow = {
  id: "a-photo",
  tenantId: "t-1",
  conversationId: "c-1",
  messageId: "msg-1",
  uploaderMembershipId: SENDER.id,
  kind: "PHOTO",
  position: 0,
  storageKey: "t-1/1b0c9f0e.jpg",
  thumbKey: "t-1/2c1d0a1f.webp",
  contentType: "image/jpeg",
  byteSize: 182_000,
  fileName: null,
  width: 1600,
  height: 1200,
  createdAt: AT,
};
const FILE: ChatAttachmentRow = {
  ...PHOTO,
  id: "a-file",
  kind: "FILE",
  position: 1,
  storageKey: "t-1/3d2e1b2a.pdf",
  thumbKey: null,
  contentType: "application/pdf",
  byteSize: 1_258_291,
  fileName: "Minutes.pdf",
  width: null,
  height: null,
};
/** Where the bytes are, which nothing a member is sent may carry: only the links route signs a way to them. */
const KEYS = [PHOTO.storageKey, PHOTO.thumbKey!, FILE.storageKey];

describe("toChatAttachmentDto", () => {
  it("describes a photo or file field by field, with no keys, uploader, conversation, message or link", () => {
    expect(toChatAttachmentDto(PHOTO)).toEqual({ id: "a-photo", kind: "PHOTO", name: null, contentType: "image/jpeg", size: 182_000, width: 1600, height: 1200 });
    expect(toChatAttachmentDto(FILE)).toEqual({ id: "a-file", kind: "FILE", name: "Minutes.pdf", contentType: "application/pdf", size: 1_258_291, width: null, height: null });
    const json = JSON.stringify([toChatAttachmentDto(PHOTO), toChatAttachmentDto(FILE)]);
    for (const secret of [...KEYS, PHOTO.tenantId, PHOTO.conversationId, PHOTO.messageId!, SENDER.id]) expect(json).not.toContain(secret);
  });

  it("never names a photo, whatever its row holds", () => {
    expect(toChatAttachmentDto({ ...PHOTO, fileName: "IMG_2041 at home.jpg" }).name).toBeNull();
  });
});

describe("toChatMessageDto", () => {
  it("carries its photos and files in the order given, and none when it has none", () => {
    expect(toChatMessageDto(message(), SENDER, VIEWER, false, [PHOTO, FILE]).attachments.map((a) => a.id)).toEqual(["a-photo", "a-file"]);
    expect(toChatMessageDto(message(), SENDER, VIEWER).attachments).toEqual([]);
  });

  it("shows none on a removed message, or one redacted for this member, as it shows no words", () => {
    const removed = toChatMessageDto(message({ removedAt: AT }), SENDER, VIEWER, false, [PHOTO, FILE]);
    expect(removed).toMatchObject({ removed: true, body: null, attachments: [] });
    const redacted = toChatMessageDto(message(), SENDER, VIEWER, true, [PHOTO, FILE]);
    expect(redacted).toMatchObject({ redacted: true, body: null, sender: null, attachments: [] });
    // Even a file's name goes with them.
    expect(JSON.stringify([removed, redacted])).not.toContain("Minutes");
  });

  it("never carries where the bytes are", () => {
    const json = JSON.stringify(toChatMessageDto(message(), SENDER, SENDER.id, false, [PHOTO, FILE]));
    for (const key of KEYS) expect(json).not.toContain(key);
  });
});

describe("toChatLastMessageDto", () => {
  const SUMMARY = { photos: 1, files: 1, fileName: "Minutes.pdf" };

  it("counts the last message's photos and files for the inbox", () => {
    const last = toChatLastMessageDto(message(), SENDER, VIEWER, { inGroup: true, redacted: false, attachments: SUMMARY });
    expect(last).toMatchObject({ body: "See these", attachments: { photos: 1, files: 1, fileName: "Minutes.pdf" } });
    expect(Object.keys(last.attachments!).sort()).toEqual(["fileName", "files", "photos"]);
    expect(toChatLastMessageDto(message(), SENDER, VIEWER, { inGroup: false, redacted: false }).attachments).toBeNull();
    expect(toChatLastMessageDto(message(), SENDER, VIEWER, { inGroup: false, redacted: false, attachments: null }).attachments).toBeNull();
  });

  it("says nothing of a removed or redacted message's, not even a file's name", () => {
    const removed = toChatLastMessageDto(message({ removedAt: AT }), SENDER, VIEWER, { inGroup: false, redacted: false, attachments: SUMMARY });
    const redacted = toChatLastMessageDto(message(), SENDER, VIEWER, { inGroup: true, redacted: true, attachments: SUMMARY });
    expect([removed.attachments, redacted.attachments]).toEqual([null, null]);
    expect(JSON.stringify([removed, redacted])).not.toContain("Minutes");
  });
});
