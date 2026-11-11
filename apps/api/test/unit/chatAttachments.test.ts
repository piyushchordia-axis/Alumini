import {
  CHAT_ATTACHMENT_LIMIT_TEXT,
  CHAT_ATTACHMENT_LINK_TTL_SEC,
  CHAT_ATTACHMENT_TYPE_PROBLEM,
  CHAT_ATTACHMENTS_NOT_YET_TEXT,
  CHAT_FILE_NAME_MAX_LENGTH,
  CHAT_FILE_SIZE_PROBLEM,
  ERROR_CODES,
  IMAGE_SIZE_PROBLEM,
  IMAGE_TYPE_PROBLEM,
  chatAttachmentLinksQuerySchema,
  chatDirectCreateSchema,
  chatMessageCreateSchema,
  type ChatAttachmentDto,
} from "@illuminize/shared";
import {
  CHAT_ATTACHMENT_LINK_FRESH_MS,
  CHAT_ATTACH_FAILED_TEXT,
  CHAT_ATTACH_LABEL,
  CHAT_REPORT_INTRO,
  CHAT_TRAY_LABEL,
  CHAT_FILE_DEFAULT_NAME,
  CHAT_FILE_OPEN_HINT,
  attachmentA11yText,
  attachmentPreviewText,
  attachmentSummary,
  chatAttachmentKindOf,
  chatAttachmentProblem,
  chatFileName,
  chatUploadTimeoutMs,
  fileDownloadLabel,
  fileMetaText,
  fileOpenLabel,
  formatFileSize,
  messagePreviewText,
  photoBoxSize,
  photoGridLayout,
  photoOpenLabel,
  photoViewerTitle,
  trayAdd,
  trayAttachments,
  trayFailed,
  trayFromAttachments,
  trayFull,
  trayItemLabels,
  trayItemName,
  trayReady,
  trayRemove,
  trayRetry,
  trayRoom,
  traySendable,
  trayStatusText,
  type TrayItem,
  type TrayPick,
} from "@illuminize/shared/chat";
import { MemoryTokenStorage, UPLOAD_TIMEOUT_MS, createApiClient } from "@illuminize/shared/client";
import { describe, expect, it } from "vitest";

const MB = 1024 * 1024;
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("chatAttachmentProblem", () => {
  it("takes the three photo types under the upload limit, and a PDF up to 10 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(chatAttachmentProblem({ type, size: 2 * MB }), type).toBeNull();
      expect(chatAttachmentKindOf({ type }), type).toBe("PHOTO");
    }
    expect(chatAttachmentProblem({ type: "application/pdf", size: 10 * MB, name: "Minutes.pdf" })).toBeNull();
    expect(chatAttachmentKindOf({ type: "application/pdf" })).toBe("FILE");
    // An unknown size passes; the server checks again.
    expect(chatAttachmentProblem({ type: "image/jpeg" })).toBeNull();
    expect(chatAttachmentProblem({ type: "application/pdf", size: null })).toBeNull();
  });

  it("says what's too big, for photos as any upload says it", () => {
    expect(chatAttachmentProblem({ type: "image/jpeg", size: 5 * MB + 1 })).toBe(IMAGE_SIZE_PROBLEM);
    expect(chatAttachmentProblem({ type: "application/pdf", size: 10 * MB + 1 })).toBe(CHAT_FILE_SIZE_PROBLEM);
    expect(CHAT_FILE_SIZE_PROBLEM).toBe("Choose a PDF under 10 MB.");
  });

  it("names the photo types for an image the server can't read, and both kinds for anything else", () => {
    for (const type of ["image/heic", "image/gif", "image/svg+xml"]) expect(chatAttachmentProblem({ type, size: 100 }), type).toBe(IMAGE_TYPE_PROBLEM);
    for (const type of ["text/html", "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/x-msdownload"]) {
      expect(chatAttachmentProblem({ type, size: 100, name: "file.pdf" }), type).toBe(CHAT_ATTACHMENT_TYPE_PROBLEM);
      expect(chatAttachmentKindOf({ type, name: "file.pdf" }), type).toBeNull();
    }
    expect(CHAT_ATTACHMENT_TYPE_PROBLEM).toBe("Choose a photo (JPEG, PNG or WebP) or a PDF.");
  });

  it("goes by a PDF's name only when the picker gave no type of its own", () => {
    for (const type of ["", "application/octet-stream", null]) {
      expect(chatAttachmentKindOf({ type, name: "Minutes.PDF" }), String(type)).toBe("FILE");
      expect(chatAttachmentProblem({ type, name: "Minutes.txt", size: 10 }), String(type)).toBe(CHAT_ATTACHMENT_TYPE_PROBLEM);
    }
  });
});

describe("chatFileName", () => {
  it("keeps a good name as it is, and gives one without the extension its .pdf", () => {
    expect(chatFileName("Minutes.pdf")).toBe("Minutes.pdf");
    expect(chatFileName("Minutes")).toBe("Minutes.pdf");
    expect(chatFileName("Annual report.PDF")).toBe("Annual report.pdf");
  });

  it("leaves nothing that reaches outside a folder or can't be in a file name", () => {
    expect(chatFileName("../../etc/passwd")).toBe("etcpasswd.pdf");
    expect(chatFileName("..\\..\\Windows\\win.ini")).toBe("Windowswin.ini.pdf");
    expect(chatFileName('a:b*c?"d<e>f|g.pdf')).toBe("abcdefg.pdf");
    expect(chatFileName(".hidden.pdf")).toBe("hidden.pdf");
  });

  it("drops control characters and the invisible ones that could disguise a name", () => {
    expect(chatFileName("Re\u0000port\u0007\n.pdf")).toBe("Report.pdf");
    // Right-to-left override: "invoice\u202Efdp.exe" shows as "invoiceexe.pdf".
    expect(chatFileName("invoice\u202Efdp.exe")).toBe("invoicefdp.exe.pdf");
    expect(chatFileName("Mi\u200Bnutes\uFEFF.pdf")).toBe("Minutes.pdf");
  });

  it("composes accents (NFC) and keeps one space for any run of white space", () => {
    const decomposed = "Re\u0301sume\u0301.pdf";
    expect(chatFileName(decomposed)).toBe("R\u00E9sum\u00E9.pdf");
    expect(chatFileName("  Annual   report \t 2026 .PDF ")).toBe("Annual report 2026.pdf");
  });

  it("caps the length with the extension kept, never splitting a character", () => {
    const long = chatFileName(`${"a".repeat(200)}.pdf`);
    expect(long).toHaveLength(CHAT_FILE_NAME_MAX_LENGTH);
    expect(long.endsWith(".pdf")).toBe(true);
    const emoji = chatFileName(`${"\u{1F600}".repeat(70)}.pdf`);
    expect(emoji.length).toBeLessThanOrEqual(CHAT_FILE_NAME_MAX_LENGTH);
    expect(emoji.endsWith(".pdf")).toBe(true);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("falls back to a plain name when nothing usable is left, and cleans nothing twice", () => {
    for (const raw of [null, undefined, "", "   ", "....", ".pdf", "/\\:*?", "\u202E"]) expect(chatFileName(raw), String(raw)).toBe(CHAT_FILE_DEFAULT_NAME);
    for (const raw of ["../a b/c.pdf", "x".repeat(300), "Re\u0301sume\u0301", " .. Minutes .. "]) expect(chatFileName(chatFileName(raw)), raw).toBe(chatFileName(raw));
  });
});

describe("formatFileSize", () => {
  it("writes bytes, KB and MB by hand, with one decimal below 10 MB", () => {
    expect(formatFileSize(0)).toBe("0 bytes");
    expect(formatFileSize(1)).toBe("1 byte");
    expect(formatFileSize(1023)).toBe("1023 bytes");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("2 KB");
    expect(formatFileSize(48 * 1024)).toBe("48 KB");
    // Just under a megabyte would round to 1024 KB, so it reads as a megabyte.
    expect(formatFileSize(MB - 1)).toBe("1 MB");
    expect(formatFileSize(MB)).toBe("1 MB");
    expect(formatFileSize(1_258_291)).toBe("1.2 MB");
    expect(formatFileSize(5 * MB)).toBe("5 MB");
    expect(formatFileSize(9.96 * MB)).toBe("10 MB");
    expect(formatFileSize(10 * MB)).toBe("10 MB");
    expect(formatFileSize(12.6 * MB)).toBe("13 MB");
  });

  it("puts the type before the size under a file's name", () => {
    expect(fileMetaText({ contentType: "application/pdf", size: 1_258_291 })).toBe("PDF · 1.2 MB");
    expect(fileMetaText({ contentType: "image/webp", size: 2048 })).toBe("WebP · 2 KB");
    expect(fileMetaText({ contentType: "text/plain", size: 10 })).toBe("File · 10 bytes");
  });
});

const photo = (id: string, width = 1200, height = 900): ChatAttachmentDto => ({ id, kind: "PHOTO", name: null, contentType: "image/jpeg", size: 200_000, width, height });
const file = (id: string, name: string): ChatAttachmentDto => ({ id, kind: "FILE", name, contentType: "application/pdf", size: 1_258_291, width: null, height: null });

describe("previews and what a screen reader hears", () => {
  it("counts a message's photos and files, with the first file's name", () => {
    expect(attachmentSummary([])).toBeNull();
    expect(attachmentSummary([photo("p1"), file("f1", "Agenda.pdf"), file("f2", "Minutes.pdf")])).toEqual({ photos: 1, files: 2, fileName: "Agenda.pdf" });
    expect(attachmentPreviewText(attachmentSummary([photo("p1")]))).toBe("Photo");
  });

  it("reads a summary as the inbox shows it", () => {
    expect(attachmentPreviewText(null)).toBe("");
    expect(attachmentPreviewText({ photos: 0, files: 0, fileName: null })).toBe("");
    expect(attachmentPreviewText({ photos: 0, files: 1, fileName: null })).toBe(`File: ${CHAT_FILE_DEFAULT_NAME}`);
    expect(messagePreviewText("Hello", null)).toBe("Hello");
    expect(messagePreviewText("", { photos: 2, files: 0, fileName: null })).toBe("2 photos");
    // A caption of invisible characters is no caption.
    expect(messagePreviewText("\u200B", { photos: 1, files: 0, fileName: null })).toBe("Photo");
  });

  it("says what a message carries before its words, counting each kind", () => {
    expect(attachmentA11yText([])).toBe("");
    expect(attachmentA11yText([photo("p1")])).toBe("Photo.");
    expect(attachmentA11yText([file("f1", "A.pdf")])).toBe("File.");
    expect(attachmentA11yText([photo("p1"), photo("p2")])).toBe("2 photos.");
    expect(attachmentA11yText([photo("p1"), photo("p2"), file("f1", "A.pdf")])).toBe("2 photos and a file.");
    expect(attachmentA11yText([photo("p1"), file("f1", "A.pdf")])).toBe("A photo and a file.");
    expect(attachmentA11yText([photo("p1"), file("f1", "A.pdf"), file("f2", "B.pdf")])).toBe("A photo and 2 files.");
    expect(attachmentA11yText([file("f1", "A.pdf"), file("f2", "B.pdf")])).toBe("2 files.");
  });

  it("never puts a link in anything a preview or a screen reader says", () => {
    const said = [attachmentPreviewText(attachmentSummary([file("f1", "Agenda.pdf")])), attachmentA11yText([photo("p1"), file("f1", "Agenda.pdf")])].join(" ");
    expect(said).not.toMatch(/https?:|\/files\//);
  });
});

describe("photoGridLayout", () => {
  it("draws one photo full width, as tall as its shape asks within 120 to 320", () => {
    expect(photoBoxSize(1200, 900)).toEqual({ width: 260, height: 195 });
    expect(photoBoxSize(900, 1200)).toEqual({ width: 260, height: 320 });
    expect(photoBoxSize(2000, 400)).toEqual({ width: 260, height: 120 });
    expect(photoBoxSize(null, null)).toEqual({ width: 260, height: 195 });
    expect(photoBoxSize(0, 500)).toEqual({ width: 260, height: 195 });
    expect(photoBoxSize(500, 500, 200)).toEqual({ width: 200, height: 200 });
    expect(photoGridLayout([photo("p1", 900, 1200)])).toEqual({ width: 260, height: 320, cells: [{ x: 0, y: 0, width: 260, height: 320 }] });
  });

  it("puts two side by side as squares, a third across the bottom, and four in a square", () => {
    expect(photoGridLayout([])).toEqual({ width: 0, height: 0, cells: [] });
    expect(photoGridLayout([photo("a"), photo("b")])).toEqual({
      width: 260,
      height: 128,
      cells: [
        { x: 0, y: 0, width: 128, height: 128 },
        { x: 132, y: 0, width: 128, height: 128 },
      ],
    });
    expect(photoGridLayout([photo("a"), photo("b"), photo("c")]).cells[2]).toEqual({ x: 0, y: 132, width: 260, height: 128 });
    expect(photoGridLayout([photo("a"), photo("b"), photo("c")]).height).toBe(260);
    const four = photoGridLayout([photo("a"), photo("b"), photo("c"), photo("d")]);
    expect(four.height).toBe(260);
    expect(four.cells[3]).toEqual({ x: 132, y: 132, width: 128, height: 128 });
  });

  it("keeps every cell inside the grid, with none overlapping, at any width", () => {
    for (const width of [180, 220, 260, 301]) {
      for (let n = 1; n <= 4; n++) {
        const grid = photoGridLayout(Array.from({ length: n }, (_, i) => photo(`p${i}`)), width);
        expect(grid.cells).toHaveLength(n);
        for (const c of grid.cells) {
          expect(c.x + c.width).toBeLessThanOrEqual(grid.width);
          expect(c.y + c.height).toBeLessThanOrEqual(grid.height);
        }
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const [a, b] = [grid.cells[i]!, grid.cells[j]!];
            expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${width}/${n}: ${i} and ${j}`).toBe(true);
          }
        }
      }
    }
  });
});

describe("chatUploadTimeoutMs", () => {
  it("allows a slow connection's time for the size, and never less than any upload's limit", () => {
    expect(chatUploadTimeoutMs(0)).toBe(UPLOAD_TIMEOUT_MS);
    expect(chatUploadTimeoutMs(MB)).toBe(UPLOAD_TIMEOUT_MS);
    // 10 MB at 50 KB a second.
    expect(chatUploadTimeoutMs(10 * MB)).toBe(204_800);
    expect(chatUploadTimeoutMs(-5)).toBe(UPLOAD_TIMEOUT_MS);
  });

  it("refreshes links before they expire", () => {
    expect(CHAT_ATTACHMENT_LINK_FRESH_MS).toBe(8 * 60_000);
    expect(CHAT_ATTACHMENT_LINK_FRESH_MS).toBeLessThan(CHAT_ATTACHMENT_LINK_TTL_SEC * 1000);
  });
});

const jpeg = (key: string, extra: Partial<TrayPick> = {}): TrayPick => ({ key, type: "image/jpeg", size: 300_000, name: "IMG_0001.jpg", previewUri: `blob:${key}`, width: 1200, height: 900, ...extra });
const pdf = (key: string, name = "Minutes.pdf", extra: Partial<TrayPick> = {}): TrayPick => ({ key, type: "application/pdf", size: 1_258_291, name, previewUri: "ignored", ...extra });
const uploaded = (tray: TrayItem[], key: string, id: string) => {
  const item = tray.find((i) => i.key === key)!;
  return trayReady(tray, key, item.kind === "PHOTO" ? photo(id, item.width!, item.height!) : file(id, item.name!));
};

describe("the tray", () => {
  it("adds picks as uploading, a photo with its preview and a file under its cleaned name", () => {
    const { tray, added, refused, refusedKeys } = trayAdd([], [jpeg("k1"), pdf("k2", "../Minutes")]);
    expect(refused).toBeNull();
    expect(refusedKeys).toEqual([]);
    expect(added).toEqual(tray);
    expect(tray).toEqual([
      { key: "k1", kind: "PHOTO", name: null, contentType: "image/jpeg", size: 300_000, previewUri: "blob:k1", width: 1200, height: 900, status: "uploading", error: null, attachment: null },
      { key: "k2", kind: "FILE", name: "Minutes.pdf", contentType: "application/pdf", size: 1_258_291, previewUri: null, width: null, height: null, status: "uploading", error: null, attachment: null },
    ]);
  });

  it("stops at four, turning the rest away with the limit, and says the first reason a pick was turned away", () => {
    const three = trayAdd([], [jpeg("k1"), jpeg("k2"), jpeg("k3")]).tray;
    const more = trayAdd(three, [jpeg("k4"), jpeg("k5"), pdf("k6")]);
    expect(more.added.map((i) => i.key)).toEqual(["k4"]);
    expect(more.refused).toBe(CHAT_ATTACHMENT_LIMIT_TEXT);
    expect(more.refusedKeys).toEqual(["k5", "k6"]);
    expect(CHAT_ATTACHMENT_LIMIT_TEXT).toBe("You can add up to 4 photos or files to a message.");
    expect(trayFull(more.tray)).toBe(true);
    expect(trayRoom(more.tray)).toBe(0);
    expect(trayRoom(three)).toBe(1);
    expect(trayAdd(more.tray, [jpeg("k7")])).toMatchObject({ added: [], refused: CHAT_ATTACHMENT_LIMIT_TEXT, refusedKeys: ["k7"] });

    const mixed = trayAdd([], [{ key: "h1", type: "image/heic", size: 100 }, jpeg("k1"), pdf("big", "Big.pdf", { size: 11 * MB })]);
    expect(mixed.added.map((i) => i.key)).toEqual(["k1"]);
    expect(mixed.refused).toBe(IMAGE_TYPE_PROBLEM);
    expect(mixed.refusedKeys).toEqual(["h1", "big"]);
  });

  it("changes nothing it was given", () => {
    const tray = trayAdd([], [jpeg("k1")]).tray;
    const before = structuredClone(tray);
    trayAdd(tray, [jpeg("k2")]);
    trayReady(tray, "k1", photo("a1"));
    trayRemove(tray, "k1");
    expect(tray).toEqual(before);
  });

  it("is ready once uploaded, with the size the server kept, and can fail and be tried again", () => {
    let tray = trayAdd([], [jpeg("k1"), pdf("k2", "notes")]).tray;
    tray = trayReady(tray, "k1", { ...photo("a1"), size: 180_000 });
    expect(tray[0]).toMatchObject({ status: "ready", size: 180_000, attachment: { id: "a1" }, name: null });
    tray = trayReady(tray, "k2", file("a2", "Server's notes.pdf"));
    expect(tray[1]).toMatchObject({ status: "ready", name: "Server's notes.pdf" });
    tray = trayFailed(tray, "k1", "The upload is taking too long.");
    expect(tray[0]).toMatchObject({ status: "failed", error: "The upload is taking too long.", attachment: null });
    tray = trayRetry(tray, "k1");
    expect(tray[0]).toMatchObject({ status: "uploading", error: null, attachment: null });
  });

  it("moves focus to the next tile after a remove, or to the attach button after the last", () => {
    const tray = trayAdd([], [jpeg("k1"), jpeg("k2"), pdf("k3")]).tray;
    expect(trayRemove(tray, "k1")).toMatchObject({ focusKey: "k2", removed: { key: "k1" } });
    expect(trayRemove(tray, "k3")).toMatchObject({ focusKey: null, removed: { key: "k3" } });
    expect(trayRemove(tray, "k2").tray.map((i) => i.key)).toEqual(["k1", "k3"]);
    expect(trayRemove(tray, "nope")).toEqual({ tray, removed: null, focusKey: null });
  });

  it("names photos by their place among the photos, and files by name", () => {
    const tray = trayAdd([], [pdf("f1"), jpeg("k1"), jpeg("k2")]).tray;
    expect(trayItemName(tray, "k1")).toBe("Photo 1");
    expect(trayItemName(tray, "k2")).toBe("Photo 2");
    expect(trayItemName(tray, "f1")).toBe("Minutes.pdf");
    expect(trayItemLabels(tray, "k2")).toEqual({ name: "Photo 2", remove: "Remove photo 2", retry: "Try uploading photo 2 again", busy: "Uploading photo 2" });
    expect(trayItemLabels(tray, "f1")).toEqual({ name: "Minutes.pdf", remove: "Remove Minutes.pdf", retry: "Try uploading Minutes.pdf again", busy: "Uploading Minutes.pdf" });
  });

  it("says what's uploading, and a failure before that", () => {
    expect(trayStatusText([])).toBe("");
    expect(trayStatusText(trayAdd([], [jpeg("k1")]).tray)).toBe("Uploading 1 photo…");
    expect(trayStatusText(trayAdd([], [jpeg("k1"), jpeg("k2")]).tray)).toBe("Uploading 2 photos…");
    expect(trayStatusText(trayAdd([], [pdf("f1")]).tray)).toBe("Uploading 1 file…");
    expect(trayStatusText(trayAdd([], [pdf("f1"), pdf("f2")]).tray)).toBe("Uploading 2 files…");
    const mixed = trayAdd([], [jpeg("k1"), pdf("f1"), jpeg("k2")]).tray;
    expect(trayStatusText(mixed)).toBe("Uploading 3 attachments…");
    expect(trayStatusText(uploaded(mixed, "k1", "a1"))).toBe("Uploading 2 attachments…");
    expect(trayStatusText(trayFailed(mixed, "k2", "Choose an image under 5 MB."))).toBe("Photo 2 wasn't uploaded: Choose an image under 5 MB.");
    expect(trayStatusText(trayFailed(mixed, "f1", ""))).toBe("Minutes.pdf wasn't uploaded.");
    expect(trayStatusText(uploaded(uploaded(trayAdd([], [jpeg("k1"), pdf("f1")]).tray, "k1", "a1"), "f1", "a2"))).toBe("");
  });

  it("lets Send go with words or something uploaded, once nothing is uploading or failed", () => {
    expect(traySendable([], "")).toEqual({ ok: false, reason: null });
    expect(traySendable([], "\u200B ")).toEqual({ ok: false, reason: null });
    expect(traySendable([], "Hello")).toEqual({ ok: true, reason: null });
    const tray = trayAdd([], [jpeg("k1"), jpeg("k2")]).tray;
    expect(traySendable(tray, "Hello")).toEqual({ ok: false, reason: "Wait for uploads to finish" });
    const one = uploaded(tray, "k1", "a1");
    expect(traySendable(trayFailed(one, "k2", "Offline"), "Hello")).toEqual({ ok: false, reason: "Remove or retry what didn't upload" });
    expect(traySendable(uploaded(one, "k2", "a2"), "")).toEqual({ ok: true, reason: null });
  });

  it("hands the send what's uploaded, in order, with the previews, and takes it back the same way", () => {
    const tray = uploaded(uploaded(trayAdd([], [jpeg("k1"), pdf("f1"), jpeg("k2")]).tray, "k1", "a1"), "f1", "a2");
    expect(trayAttachments(tray)).toEqual([
      { ...photo("a1"), previewUri: "blob:k1" },
      { ...file("a2", "Minutes.pdf"), previewUri: null },
    ]);
    const back = trayFromAttachments(trayAttachments(tray));
    expect(back.map((i) => [i.key, i.status, i.previewUri])).toEqual([
      ["a1", "ready", "blob:k1"],
      ["a2", "ready", null],
    ]);
    expect(trayAttachments(back)).toEqual(trayAttachments(tray));
  });
});

describe("the message schemas", () => {
  const clientKey = "client-key-1";

  it("takes words, photos and files, or both, and refuses a message with neither", () => {
    expect(chatMessageCreateSchema.parse({ body: "Hello", clientKey })).toEqual({ body: "Hello", clientKey, attachmentIds: [] });
    expect(chatMessageCreateSchema.parse({ clientKey, attachmentIds: [ID(1)] })).toEqual({ body: "", clientKey, attachmentIds: [ID(1)] });
    expect(chatMessageCreateSchema.parse({ body: "  See you \u0000", clientKey, attachmentIds: [ID(1), ID(2)] })).toEqual({ body: "See you", clientKey, attachmentIds: [ID(1), ID(2)] });
    // Invisible characters alone are no caption.
    expect(chatMessageCreateSchema.parse({ body: "\u200B", clientKey, attachmentIds: [ID(1)] }).body).toBe("");
    for (const body of ["", "   ", "\u200B"]) {
      const res = chatMessageCreateSchema.safeParse({ body, clientKey });
      expect(res.success, JSON.stringify(body)).toBe(false);
      expect(res.error!.issues[0]).toMatchObject({ path: ["body"], message: "Write a message" });
    }
    expect(chatMessageCreateSchema.safeParse({ body: "x".repeat(4001), clientKey, attachmentIds: [ID(1)] }).success).toBe(false);
  });

  it("refuses more than four, the same one twice, and anything that isn't an upload's id", () => {
    const five = chatMessageCreateSchema.safeParse({ clientKey, attachmentIds: [1, 2, 3, 4, 5].map(ID) });
    expect(five.error!.issues[0]!.message).toBe(CHAT_ATTACHMENT_LIMIT_TEXT);
    expect(chatMessageCreateSchema.safeParse({ clientKey, attachmentIds: [1, 2, 3, 4].map(ID) }).success).toBe(true);
    expect(chatMessageCreateSchema.safeParse({ clientKey, attachmentIds: [ID(1), ID(1)] }).success).toBe(false);
    expect(chatMessageCreateSchema.safeParse({ clientKey, attachmentIds: ["not-an-id"] }).success).toBe(false);
  });

  it("keeps a first message to words, refusing one that names uploads", () => {
    const membershipId = ID(9);
    expect(chatDirectCreateSchema.parse({ membershipId, body: "Hello", clientKey })).toEqual({ membershipId, body: "Hello", clientKey });
    for (const attachmentIds of [[ID(1)], []]) {
      const res = chatDirectCreateSchema.safeParse({ membershipId, body: "Hello", clientKey, attachmentIds });
      expect(res.success).toBe(false);
      expect(res.error!.issues[0]).toMatchObject({ path: ["attachmentIds"], message: CHAT_ATTACHMENTS_NOT_YET_TEXT });
    }
    expect(chatDirectCreateSchema.safeParse({ membershipId, body: "", clientKey }).success).toBe(false);
  });

  it("reads one message or several to sign links for, up to 50, each once", () => {
    expect(chatAttachmentLinksQuerySchema.parse({ messageId: ID(1) })).toEqual({ messageId: [ID(1)] });
    expect(chatAttachmentLinksQuerySchema.parse({ messageId: [ID(1), ID(2), ID(1)] })).toEqual({ messageId: [ID(1), ID(2)] });
    expect(chatAttachmentLinksQuerySchema.safeParse({ messageId: Array.from({ length: 50 }, (_, i) => ID(i)) }).success).toBe(true);
    expect(chatAttachmentLinksQuerySchema.safeParse({ messageId: Array.from({ length: 51 }, (_, i) => ID(i)) }).success).toBe(false);
    for (const messageId of [undefined, [], "nope", [ID(1), "nope"]]) expect(chatAttachmentLinksQuerySchema.safeParse({ messageId }).success, JSON.stringify(messageId)).toBe(false);
  });

  it("has an error code for each refusal the apps tell apart", () => {
    expect(ERROR_CODES).toContain("CHAT_ATTACHMENT_GONE");
    expect(ERROR_CODES).toContain("CHAT_ATTACHMENTS_NOT_YET");
  });
});

describe("the client's attachment calls", () => {
  function client() {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body });
      return Response.json({ data: { ok: true } }, { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, api: createApiClient({ baseUrl: "http://api.test", storage: new MemoryTokenStorage(), fetch: fetchImpl }) };
  }

  it("uploads to the conversation with the file's name in a field of its own, ahead of the file", async () => {
    const { calls, api } = client();
    const pdfFile = new File([new TextEncoder().encode("%PDF-1.4\n")], "R\u00E9sum\u00E9.pdf", { type: "application/pdf" });
    await api.chat.attach("demo", "c1", pdfFile);
    expect(calls[0]).toMatchObject({ url: "http://api.test/api/v1/t/demo/chat/conversations/c1/attachments", method: "POST" });
    const form = calls[0]!.body as FormData;
    expect([...form.keys()]).toEqual(["name", "file"]);
    expect(form.get("name")).toBe("R\u00E9sum\u00E9.pdf");
    expect((form.get("file") as File).type).toBe("application/pdf");

    await api.chat.attach("demo", "c1", new Blob(["x"], { type: "image/jpeg" }), { name: "Cleaned.jpg" });
    expect((calls[1]!.body as FormData).get("name")).toBe("Cleaned.jpg");
  });

  it("asks for several messages' links in one call", async () => {
    const { calls, api } = client();
    await api.chat.attachmentLinks("demo", "c1", [ID(1), ID(2)]);
    expect(calls[0]).toMatchObject({ method: "GET", url: `http://api.test/api/v1/t/demo/chat/conversations/c1/attachments?messageId=${ID(1)}&messageId=${ID(2)}` });
  });
});

describe("what the apps call photos and files in a thread", () => {
  it("names each photo by its place, the viewer by whose photos they are, and a file's download by its name", () => {
    expect(photoOpenLabel(0, 1)).toBe("Open photo 1 of 1");
    expect(photoOpenLabel(2, 4)).toBe("Open photo 3 of 4");
    expect(photoViewerTitle(0, 1, "Meera Iyer")).toBe("Photo 1 of 1 from Meera Iyer");
    expect(photoViewerTitle(1, 2, "you")).toBe("Photo 2 of 2 from you");
    expect(fileDownloadLabel("notes.pdf")).toBe("Download notes.pdf");
    expect(fileDownloadLabel(null)).toBe(`Download ${CHAT_FILE_DEFAULT_NAME}`);
  });

  it("names a file's row on the phone by what tapping it does", () => {
    expect(fileOpenLabel("notes.pdf")).toBe("Open notes.pdf");
    expect(fileOpenLabel(null)).toBe(`Open ${CHAT_FILE_DEFAULT_NAME}`);
    expect(fileOpenLabel("")).toBe(`Open ${CHAT_FILE_DEFAULT_NAME}`);
    expect(CHAT_FILE_OPEN_HINT).toBe("Downloads it and opens the share sheet");
  });

  it("keeps the words e2e and both apps look for", () => {
    expect(CHAT_ATTACH_LABEL).toBe("Add photos or a file");
    expect(CHAT_TRAY_LABEL).toBe("Attachments to send");
    expect(CHAT_ATTACH_FAILED_TEXT).toBe("That couldn't be added. Try again.");
    expect(CHAT_REPORT_INTRO).toBe("Admins will see this message and up to 10 around it, with any photos and files in them.");
  });
});
