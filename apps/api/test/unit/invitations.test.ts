import {
  MAX_INVITE_IMPORT_ROWS,
  channelsSentence,
  chunkInviteRows,
  deliveryText,
  importDoneText,
  importIgnoredText,
  importInChunks,
  importProblems,
  importProgressText,
  importResultText,
  importRowTooLong,
  importSummaryText,
  invitationActionLabel,
  invitationActions,
  invitationMeta,
  invitationName,
  invitationStatusFilter,
  invitationStatusView,
  invitationTemplateCsv,
  inviteShareText,
  isOpenInvitation,
  parseCsv,
  parseInvitationTab,
  partialImportText,
  readInvitationCsv,
  rowCountText,
  sendCountText,
  sendNowLabel,
  sendPendingCopy,
  sendPendingDoneText,
  sentText,
  sumImportResults,
  toImportRows,
  whatsappUrl,
  withBom,
  type InvitationDto,
  type InvitationImportResultDto,
  type InvitationImportRow,
  type InviteImportField,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const FIELDS: InviteImportField[] = [
  { key: "chapter", label: "Chapter", type: "SELECT" },
  { key: "interests", label: "Community interests", type: "MULTI_SELECT" },
  { key: "volunteer", label: "Volunteers", type: "BOOLEAN" },
  { key: "year_joined", label: "Year joined", type: "NUMBER" },
];

const result = (over: Partial<InvitationImportResultDto> = {}): InvitationImportResultDto => ({ created: 0, updated: 0, skipped: 0, queued: 0, results: [], ...over });

const invitation = (over: Partial<InvitationDto> = {}): InvitationDto => ({
  id: "00000000-0000-4000-8000-000000000001",
  phone: "+919876543210",
  email: null,
  fullName: "Asha Rao",
  batchYear: 2012,
  status: "PENDING",
  expired: false,
  expiresAt: "2026-12-01T00:00:00.000Z",
  sendCount: 0,
  lastSentAt: null,
  acceptedAt: null,
  acceptedMembershipId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  link: "https://app.example/i/abcdefghijklmnop",
  delivery: null,
  ...over,
});

describe("toImportRows", () => {
  it("finds the known columns by any of their names, and the questions by key", () => {
    const csv = parseCsv("Mobile Number,Full Name,Graduation Year,E-mail,Chapter,Notes\r\n+919876543210,Asha Rao,2012,asha@example.com,surat,met at Garba\r\n");
    const m = toImportRows(csv, FIELDS);
    expect(m.phoneColumn).toBe("mobile_number");
    expect(m.columns).toEqual({ name: "full_name", batch: "graduation_year", email: "e_mail", fields: ["Chapter"] });
    expect(m.ignored).toEqual(["notes"]);
    expect(m.rows).toEqual([{ phone: "+919876543210", name: "Asha Rao", batchYear: "2012", email: "asha@example.com", fields: { chapter: "surat" } }]);
  });

  it("reads several choices from one cell, yes and no in their usual words, and numbers", () => {
    const csv = parseCsv("phone,interests,volunteer,year_joined\n1,a; b|c ,yes,2001\n2,,NO,soon\n3,a,maybe,\n");
    const [one, two, three] = toImportRows(csv, FIELDS).rows;
    expect(one!.fields).toEqual({ interests: ["a", "b", "c"], volunteer: true, year_joined: 2001 });
    // A word that isn't yes or no goes as typed, for the API to refuse with its reason; a number that isn't one too.
    expect(two!.fields).toEqual({ volunteer: false, year_joined: "soon" });
    expect(three!.fields).toEqual({ interests: ["a"], volunteer: "maybe" });
  });

  it("leaves out empty cells, and gives no phone when the list has no phone column", () => {
    const m = toImportRows(parseCsv("name,batch\nAsha,\n"), FIELDS);
    expect(m.phoneColumn).toBeUndefined();
    expect(m.rows).toEqual([{ phone: "", name: "Asha", batchYear: null, email: null, fields: {} }]);
  });
});

describe("readInvitationCsv", () => {
  it("says why a file can't be imported", () => {
    expect(readInvitationCsv("name\nAsha\n", FIELDS).problem).toBe('No phone column found. Name a column "phone" (see the template).');
    expect(readInvitationCsv("", FIELDS).problem).toMatch(/^No phone column found/);
    expect(readInvitationCsv("\uFEFFphone,name\r\n", FIELDS).problem).toBe("That file has only a header row.");
  });

  it("reads a list, and says which columns it uses and which it leaves out", () => {
    const { mapping } = readInvitationCsv("\uFEFFPhone,Name,Batch,Chapter,Notes\r\n+917600000021,Mitesh Shah,2015,surat,x\r\n+917600000022,Komal Desai,2016,surat,\r\n", FIELDS);
    expect(mapping!.rows).toHaveLength(2);
    expect(importSummaryText(mapping!)).toBe("2 rows. Using phone, name, batch, Chapter.");
    expect(importIgnoredText(mapping!)).toBe("Ignoring: notes.");
    expect(importSummaryText(readInvitationCsv("phone\n1\n", FIELDS).mapping!)).toBe("1 row. Using phone.");
    expect(importIgnoredText(readInvitationCsv("phone\n1\n", FIELDS).mapping!)).toBeNull();
  });
});

describe("invitationTemplateCsv", () => {
  const fields = [
    { key: "chapter", options: [{ value: "ahmedabad", label: "Ahmedabad" }] },
    { key: "note", options: [] },
  ];

  it("has the known columns and the questions' keys, and an example phone with no formula guard", () => {
    const text = invitationTemplateCsv(fields);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text.split("\r\n")[0]).toBe("phone,name,batch,email,chapter,note");
    expect(text.split("\r\n")[1]).toBe("+919876543210,Asha Rao,2012,asha@example.com,ahmedabad,");
    expect(parseCsv(withBom(text)).rows).toEqual([{ phone: "+919876543210", name: "Asha Rao", batch: "2012", email: "asha@example.com", chapter: "ahmedabad", note: "" }]);
  });
});

describe("withBom", () => {
  it("puts the byte order mark in front once", () => {
    expect(withBom("a,b")).toBe("\uFEFFa,b");
    expect(withBom(withBom("a,b"))).toBe("\uFEFFa,b");
    expect(withBom("")).toBe("\uFEFF");
  });
});

describe("importing in chunks", () => {
  const rows: InvitationImportRow[] = Array.from({ length: 1200 }, (_, i) => ({ phone: String(i) }));

  it("splits an import at the API's limit, each chunk numbered from the line after the header", () => {
    expect(MAX_INVITE_IMPORT_ROWS).toBe(500);
    const chunks = chunkInviteRows(rows);
    expect(chunks.map((c) => c.rows.length)).toEqual([500, 500, 200]);
    expect(chunks.map((c) => c.rowOffset)).toEqual([1, 501, 1001]);
    expect(chunks[1]!.rows[0]).toBe(rows[500]);
    expect(chunkInviteRows([])).toEqual([]);
  });

  it("adds the chunks' answers up", () => {
    const total = sumImportResults([
      result({ created: 2, updated: 1, skipped: 1, queued: 3, results: [{ row: 2, phone: "1", status: "created" }] }),
      result({ created: 1, skipped: 2, results: [{ row: 502, phone: "2", status: "invalid", message: "Not a valid phone number" }] }),
    ]);
    expect(total).toEqual({ created: 3, updated: 1, skipped: 3, queued: 3, results: [{ row: 2, phone: "1", status: "created" }, { row: 502, phone: "2", status: "invalid", message: "Not a valid phone number" }] });
    expect(sumImportResults([])).toEqual(result());
  });

  it("sends one chunk at a time, each after the one before has been answered, saying how far it has got", async () => {
    const sent: number[] = [];
    const progress: string[] = [];
    let inFlight = 0;
    let mostInFlight = 0;
    const outcome = await importInChunks(
      rows,
      async (chunk) => {
        sent.push(chunk.rowOffset);
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        // Answered a little later, so chunks sent side by side would overlap here.
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return result({ created: chunk.rows.length });
      },
      { onProgress: (done, total) => progress.push(importProgressText(done, total)) },
    );
    expect(mostInFlight).toBe(1);
    expect(sent).toEqual([1, 501, 1001]);
    expect(progress).toEqual(["Importing 500 of 1,200…", "Importing 1,000 of 1,200…", "Importing 1,200 of 1,200…"]);
    expect(outcome).toEqual({ result: result({ created: 1200 }), imported: 1200 });
  });

  it("stops at a failed chunk, sending nothing after it and keeping what the ones before it did", async () => {
    const refused = Object.assign(new Error("Too many imports"), { status: 429 });
    const sent: number[] = [];
    const outcome = await importInChunks(rows, async (chunk) => {
      sent.push(chunk.rowOffset);
      if (chunk.rowOffset === 501) throw refused;
      return result({ created: chunk.rows.length });
    });
    expect(sent).toEqual([1, 501]);
    expect(outcome).toEqual({ result: result({ created: 500 }), imported: 500, error: refused });
    expect(partialImportText(outcome.imported, outcome.error)).toBe("The first 500 rows were imported. Import the file again to finish: rows already imported are updated, not duplicated.");
    expect(partialImportText(0, refused)).toBeNull();
  });

  it("says to import again only when the failure may pass", () => {
    const again = "The first 500 rows were imported. Import the file again to finish: rows already imported are updated, not duplicated.";
    // Unreachable, broken or limiting: another try may go through.
    for (const status of [0, 429, 500, 503]) expect(partialImportText(500, Object.assign(new Error("x"), { status }))).toBe(again);
    expect(partialImportText(500, new TypeError("Failed to fetch"))).toBe(again);
    // Any other answer would come again.
    for (const status of [400, 403, 413]) expect(partialImportText(500, Object.assign(new Error("x"), { status }))).toBe("The first 500 rows were imported. Importing the file again updates them rather than adding them twice.");
  });

  it("sends a row with a cell too long for the API as a blank row on its line, and gives its own reason", async () => {
    const list: InvitationImportRow[] = [
      { phone: "+917600000001", name: "Asha", batchYear: "2012" },
      { phone: "+917600000002", name: "Ravi", batchYear: "Class of 2012" },
      { phone: "+917600000003", name: "Mina", email: `${"a".repeat(250)}@example.com` },
      { phone: `+91 76000 00004 ${"x".repeat(40)}` },
      { phone: "+917600000005", fields: { interests: Array.from({ length: 21 }, (_, i) => `c${i}`) } },
      { phone: "+917600000006", fields: { chapter: "s".repeat(2001) } },
      { phone: "+917600000007", name: "Neel" },
    ];
    expect(importRowTooLong(list[0]!, FIELDS)).toBeNull();
    expect(importRowTooLong(list[1]!, FIELDS)).toBe("Batch is too long to be a year");
    expect(importRowTooLong(list[2]!, FIELDS)).toBe("Email address is too long");
    expect(importRowTooLong(list[3]!, FIELDS)).toBe("Phone number is too long");
    expect(importRowTooLong(list[4]!, FIELDS)).toBe("Community interests: at most 20 choices");
    expect(importRowTooLong(list[5]!, FIELDS)).toBe("Chapter is too long");
    expect(importRowTooLong({ phone: "1", name: "n".repeat(201) })).toBe("Name is too long");

    let sentRows: InvitationImportRow[] = [];
    // As the API answers: each row by its line (offset + index + 1), a blank phone left out as missing.
    const outcome = await importInChunks(
      list,
      async (chunk) => {
        sentRows = chunk.rows;
        const results = chunk.rows.map((r, i) => (r.phone ? { row: chunk.rowOffset + i + 1, phone: r.phone, status: "created" as const } : { row: chunk.rowOffset + i + 1, phone: "", status: "invalid" as const, message: "Phone number missing" }));
        return result({ created: results.filter((r) => r.status === "created").length, skipped: results.filter((r) => r.status === "invalid").length, results });
      },
      { fields: FIELDS },
    );
    // Every row goes, in its place; the long ones blank.
    expect(sentRows.map((r) => r.phone)).toEqual(["+917600000001", "", "", "", "", "", "+917600000007"]);
    expect(outcome.imported).toBe(7);
    expect(outcome.result.created).toBe(2);
    expect(outcome.result.skipped).toBe(5);
    expect(importProblems(outcome.result)).toEqual([
      { row: 3, phone: "+917600000002", status: "invalid", message: "Batch is too long to be a year" },
      { row: 4, phone: "+917600000003", status: "invalid", message: "Email address is too long" },
      { row: 5, phone: `+91 76000 00004 ${"x".repeat(23)}…`, status: "invalid", message: "Phone number is too long" },
      { row: 6, phone: "+917600000005", status: "invalid", message: "Community interests: at most 20 choices" },
      { row: 7, phone: "+917600000006", status: "invalid", message: "Chapter is too long" },
    ]);
  });

  it("keeps the line numbers of a long cell's row in a later chunk", async () => {
    const many: InvitationImportRow[] = Array.from({ length: 700 }, (_, i) => ({ phone: String(i), batchYear: i === 600 ? "MBA 2012-14" : null }));
    const offsets: number[] = [];
    const outcome = await importInChunks(many, async (chunk) => {
      offsets.push(chunk.rowOffset);
      const results = chunk.rows.flatMap((r, i) => (r.phone ? [] : [{ row: chunk.rowOffset + i + 1, phone: "", status: "invalid" as const, message: "Phone number missing" }]));
      return result({ skipped: results.length, results });
    });
    expect(offsets).toEqual([1, 501]);
    // Row 600 of the data is line 602 of the file, under the header.
    expect(importProblems(outcome.result)).toEqual([{ row: 602, phone: "600", status: "invalid", message: "Batch is too long to be a year" }]);
  });

  it("says what an import did, and lists the rows it left out", () => {
    const r = result({ created: 2, updated: 1, skipped: 2, queued: 1, results: [{ row: 2, phone: "a", status: "created" }, { row: 3, phone: "b", status: "invalid", message: "Not a valid phone number" }, { row: 4, phone: "c", status: "member", message: "Already a member" }, { row: 5, phone: "d", status: "updated" }] });
    expect(importResultText(r)).toBe("2 new, 1 updated, 2 skipped, 1 being sent.");
    expect(importResultText(result({ created: 2 }))).toBe("2 new, 0 updated, 0 skipped.");
    expect(importDoneText(r)).toBe("2 invited, 1 updated, 1 sending");
    expect(importDoneText(result({ created: 2 }))).toBe("2 invited, 0 updated");
    expect(importProblems(r).map((p) => p.row)).toEqual([3, 4]);
    expect(rowCountText(1)).toBe("1 row");
    expect(rowCountText(1200)).toBe("1,200 rows");
  });
});

describe("an invitation's row", () => {
  it("shows Expired before the status it had", () => {
    expect(invitationStatusView({ status: "SENT", expired: true })).toEqual({ label: "Expired", tone: "neutral" });
    expect(invitationStatusView({ status: "PENDING", expired: true })).toEqual({ label: "Expired", tone: "neutral" });
    expect(invitationStatusView({ status: "PENDING", expired: false })).toEqual({ label: "Not sent", tone: "warning" });
    expect(invitationStatusView({ status: "SENT", expired: false })).toEqual({ label: "Sent", tone: "info" });
    expect(invitationStatusView({ status: "ACCEPTED", expired: false })).toEqual({ label: "Joined", tone: "success" });
    expect(invitationStatusView({ status: "REVOKED", expired: false })).toEqual({ label: "Revoked", tone: "danger" });
  });

  it("is named for the person, or their number, with the number in its details only beside a name", () => {
    expect(invitationName(invitation())).toBe("Asha Rao");
    expect(invitationName(invitation({ fullName: null }))).toBe("+91 98765 43210");
    expect(invitationMeta(invitation({ email: "asha@example.com" }))).toBe("+91 98765 43210 · 2012 · asha@example.com");
    expect(invitationMeta(invitation({ fullName: null, batchYear: null }))).toBe("");
  });

  it("says how its latest message went", () => {
    const ago = () => "2h ago";
    const at = "2026-11-05T10:00:00.000Z";
    expect(deliveryText(invitation(), ago)).toBe("—");
    expect(deliveryText(invitation({ sendCount: 1 }), ago)).toBe("");
    for (const status of ["QUEUED", "SENDING"] as const) expect(deliveryText(invitation({ delivery: { status, channel: null, lastError: null, at } }), ago)).toBe("Sending…");
    expect(deliveryText(invitation({ delivery: { status: "SENT", channel: "SMS", lastError: null, at } }), ago)).toBe("Sent by SMS · 2h ago");
    expect(deliveryText(invitation({ delivery: { status: "DELIVERED", channel: "WHATSAPP", lastError: null, at } }), ago)).toBe("Delivered by WhatsApp · 2h ago");
    expect(deliveryText(invitation({ delivery: { status: "READ", channel: "EMAIL", lastError: null, at } }), ago)).toBe("Read by email · 2h ago");
    expect(deliveryText(invitation({ delivery: { status: "FAILED", channel: "WHATSAPP", lastError: "Number not on WhatsApp", at } }), ago)).toBe("Failed by WhatsApp: Number not on WhatsApp");
    expect(deliveryText(invitation({ delivery: { status: "FAILED", channel: null, lastError: null, at } }), ago)).toBe("Failed");
    expect(deliveryText(invitation({ delivery: { status: "CANCELLED", channel: null, lastError: null, at } }), ago)).toBe("Not sent (closed before sending)");
    expect(sendCountText(invitation({ sendCount: 1 }))).toBeNull();
    expect(sendCountText(invitation({ sendCount: 3 }))).toBe("sent 3 times");
  });

  it("offers what can be done to it, by its status, the plan's channels and its link", () => {
    const offered = (over: Partial<InvitationDto>, channels: ("WHATSAPP" | "SMS")[] = []) =>
      Object.entries(invitationActions(invitation(over), channels))
        .filter(([, on]) => on)
        .map(([action]) => action);
    expect(offered({})).toEqual(["copy", "whatsapp", "revoke"]);
    expect(offered({}, ["WHATSAPP"])).toEqual(["copy", "whatsapp", "send", "revoke"]);
    expect(offered({ status: "SENT", sendCount: 1 }, ["SMS"])).toEqual(["copy", "whatsapp", "send", "revoke"]);
    // No link without the server's WEB_APP_URL: nothing to copy or share, but it can still be sent and revoked.
    expect(offered({ link: null }, ["WHATSAPP"])).toEqual(["send", "revoke"]);
    // Expired: the link is dead, so only Revoke.
    expect(offered({ expired: true }, ["WHATSAPP"])).toEqual(["revoke"]);
    expect(offered({ status: "ACCEPTED" }, ["WHATSAPP"])).toEqual([]);
    expect(offered({ status: "REVOKED" }, ["WHATSAPP"])).toEqual([]);
    expect(isOpenInvitation(invitation({ status: "SENT" }))).toBe(true);
    expect(isOpenInvitation(invitation({ status: "SENT", expired: true }))).toBe(false);
  });

  it("names each button for its invitation", () => {
    expect(invitationActionLabel("copy", invitation())).toBe("Copy link for Asha Rao");
    expect(invitationActionLabel("whatsapp", invitation())).toBe("Share on WhatsApp with Asha Rao");
    expect(invitationActionLabel("send", invitation())).toBe("Send to Asha Rao");
    expect(invitationActionLabel("send", invitation({ sendCount: 1 }))).toBe("Resend to Asha Rao");
    expect(invitationActionLabel("revoke", invitation({ fullName: null }))).toBe("Revoke the invitation for +91 98765 43210");
  });

  it("says what Send did, and nothing queued as sent too recently", () => {
    expect(sentText(1, false)).toBe("Invitation sent");
    expect(sentText(1, true)).toBe("Invitation sent again");
    expect(sentText(0, true)).toBe("Sent less than a day ago; try again later");
  });
});

describe("the list's tabs", () => {
  it("open All for anything that isn't a tab, and ask the API for no status there", () => {
    expect(parseInvitationTab("REVOKED")).toBe("REVOKED");
    expect(parseInvitationTab(["EXPIRED", "SENT"])).toBe("EXPIRED");
    expect(parseInvitationTab("revoked")).toBe("ALL");
    expect(parseInvitationTab(undefined)).toBe("ALL");
    expect(invitationStatusFilter("ALL")).toBeUndefined();
    expect(invitationStatusFilter("EXPIRED")).toBe("EXPIRED");
  });
});

describe("sharing and sending", () => {
  it("opens a WhatsApp chat with the number's digits and the message written in", () => {
    const text = inviteShareText("Shri Gujarati Samaj", "https://app.example/i/abc");
    expect(text).toBe("You're invited to join the Shri Gujarati Samaj alumni network on Illuminize: https://app.example/i/abc");
    const url = whatsappUrl("+91 98765-43210", text);
    expect(url.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    expect(url).toContain("Shri%20Gujarati%20Samaj");
    expect(decodeURIComponent(url.split("?text=")[1]!)).toBe(text);
    expect(whatsappUrl("+91", "a&b=c")).toBe("https://wa.me/91?text=a%26b%3Dc");
  });

  it("says how the plan sends, or that the links are shared by hand", () => {
    expect(channelsSentence(["WHATSAPP", "SMS"])).toBe("Your plan sends invitations by WhatsApp, then SMS. Each invitation can be resent once a day.");
    expect(channelsSentence(["EMAIL"])).toBe("Your plan sends invitations by email. Each invitation can be resent once a day.");
    expect(channelsSentence([])).toBe("Your plan doesn't include WhatsApp, SMS or email messages: copy an invitation's link or share it on WhatsApp from your own phone.");
    expect(sendNowLabel(["WHATSAPP", "SMS"])).toBe("Send the invitations now (by WhatsApp, then SMS)");
    expect(sendNowLabel([])).toBe("Sending isn't included in your plan; you'll share the links yourself");
  });

  it("asks before Send pending, saying it's billed and how many more can go today", () => {
    expect(sendPendingCopy(12, ["WHATSAPP", "SMS"], 180)).toEqual({
      label: "Send 12 pending",
      title: "Send 12 invitations?",
      body: "By WhatsApp, then SMS. Messages are billed per delivery; up to 180 more can go today.",
      confirm: "Send",
    });
    expect(sendPendingCopy(1, ["SMS"], 1500).title).toBe("Send 1 invitation?");
    expect(sendPendingCopy(1, ["SMS"], 1500).body).toBe("By SMS. Messages are billed per delivery; up to 1,500 more can go today.");
    // Refused once the plan stops sending, the figures come back with no channel while the question is still open.
    expect(sendPendingCopy(3, [], 0).body).toBe("Messages are billed per delivery; up to 0 more can go today.");
    expect(sendPendingDoneText(12)).toBe("Sending 12 invitations");
    expect(sendPendingDoneText(1)).toBe("Sending 1 invitation");
    expect(sendPendingDoneText(0)).toBe("Nothing to send");
  });
});
