import { inlineText, linkify, parseRichText, plainExcerpt, RICH_TEXT_HINT, textDirection, type RichBlock, type RichInline } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const t = (text: string): RichInline => ({ type: "text", text });
const a = (href: string, text = href): RichInline => ({ type: "link", href, text });
const para = (...lines: string[]): RichBlock => ({ type: "paragraph", lines: lines.map((l) => [t(l)]) });
const bullets = (...items: string[]): RichBlock => ({ type: "list", ordered: false, start: 1, items: items.map((i) => [t(i)]) });
const numbered = (start: number, ...items: string[]): RichBlock => ({ type: "list", ordered: true, start, items: items.map((i) => [t(i)]) });
/** Built from code points, so no editor or tool can quietly turn them into something else. */
const char = (code: number) => String.fromCharCode(code);
const [ZWSP, ZWNJ, ZWJ, LRM, RLM, RLO, PDF, LRI, PDI, BOM] = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202e, 0x202c, 0x2066, 0x2069, 0xfeff].map(char);
const links = (inlines: RichInline[]) => inlines.filter((i): i is Extract<RichInline, { type: "link" }> => i.type === "link");
const timed = (run: () => void) => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

describe("parseRichText: blocks", () => {
  it("returns nothing for empty text", () => {
    expect(parseRichText("")).toEqual([]);
    expect(parseRichText(null)).toEqual([]);
    expect(parseRichText(undefined)).toEqual([]);
    expect(parseRichText(" \n\t\n ")).toEqual([]);
  });

  it("keeps a paragraph's line breaks, trims each line, and ends a block at a blank or whitespace-only line", () => {
    expect(parseRichText("  First line  \nSecond line\n\n \t \nNext paragraph")).toEqual([para("First line", "Second line"), para("Next paragraph")]);
  });

  it("treats CRLF, a lone CR and the Unicode line separators as line breaks", () => {
    expect(parseRichText("One\r\nTwo\rThree\r\n\r\nFour")).toEqual([para("One", "Two", "Three"), para("Four")]);
    expect(parseRichText(`One${char(0x2028)}Two${char(0x2029)}${char(0x2029)}Three`)).toEqual([para("One", "Two"), para("Three")]);
  });

  it("makes one bullet list from every bullet marker, mixed, with up to three spaces before it", () => {
    expect(parseRichText("- dash\n* star\n• bullet\n● circle\n▪ square\n◦ ring\n– en dash\n   - indented three")).toEqual([
      bullets("dash", "star", "bullet", "circle", "square", "ring", "en dash", "indented three"),
    ]);
    expect(parseRichText("-\tTabbed\n-    Spaced  ")).toEqual([bullets("Tabbed", "Spaced")]);
  });

  it("needs whitespace and then text after a bullet marker", () => {
    expect(parseRichText("-5°C tonight\n*bold* claim\n-\n- ")).toEqual([para("-5°C tonight", "*bold* claim", "-", "-")]);
    expect(parseRichText("— em dash is not a bullet")).toEqual([para("— em dash is not a bullet")]);
  });

  it("numbers a list from its first item, with 1. or 1)", () => {
    expect(parseRichText("3. Third\n4) Fourth\n9. Ninth")).toEqual([numbered(3, "Third", "Fourth", "Ninth")]);
    expect(parseRichText("0. Zero")).toEqual([numbered(0, "Zero")]);
    expect(parseRichText("100) Hundred")).toEqual([numbered(100, "Hundred")]);
  });

  it("doesn't take a decimal, a year or a number without a space for a numbered item", () => {
    expect(parseRichText("1.5 years of experience\n2024. A good year\n1)No space")).toEqual([para("1.5 years of experience", "2024. A good year", "1)No space")]);
  });

  it("starts a new list when the kind changes, and a new block when a list meets a paragraph", () => {
    expect(parseRichText("Intro\n- a\n- b\n1. one\n2. two\nOutro")).toEqual([para("Intro"), bullets("a", "b"), numbered(1, "one", "two"), para("Outro")]);
    expect(parseRichText("- a\n\n- b")).toEqual([bullets("a"), bullets("b")]);
  });

  it("joins an indented line to the item above with a space, and leaves other lines as paragraph lines", () => {
    expect(parseRichText("- Build APIs\n  in Node.js\n\tand Postgres\n- Next")).toEqual([bullets("Build APIs in Node.js and Postgres", "Next")]);
    expect(parseRichText("- Item\n    - four spaces is no item")).toEqual([bullets("Item - four spaces is no item")]);
    expect(parseRichText("- Item\n not indented enough")).toEqual([bullets("Item"), para("not indented enough")]);
    expect(parseRichText("Paragraph\n  indented")).toEqual([para("Paragraph", "indented")]);
    expect(parseRichText("- Item\n\n  after a blank line")).toEqual([bullets("Item"), para("after a blank line")]);
  });

  it("links inside list items and paragraphs", () => {
    expect(parseRichText("Apply:\n- at https://acme.io/jobs\n- or jobs@acme.io")).toEqual([
      para("Apply:"),
      { type: "list", ordered: false, start: 1, items: [[t("at "), a("https://acme.io/jobs")], [t("or "), a("mailto:jobs@acme.io", "jobs@acme.io")]] },
    ]);
  });
});

describe("parseRichText: invisible characters", () => {
  it("strips zero-width and bidi controls, so a reversed or hidden address can't disguise a link", () => {
    const blocks = parseRichText(`${RLO}https://evil.com${PDF} and ${LRI}x${PDI}${LRM}${RLM}${BOM}`);
    expect(blocks).toEqual([{ type: "paragraph", lines: [[a("https://evil.com/", "https://evil.com"), t(" and x")]] }]);
  });

  it("removes a zero-width space inside an address before it is linked", () => {
    expect(linkify(`https://goo${ZWSP}gle.com`)).toEqual([a("https://google.com/", "https://google.com")]);
  });

  it("removes joiners next to ASCII, so they can't hide where an address ends", () => {
    expect(linkify(`https://evil.com${ZWJ}.google.com`)).toEqual([a("https://evil.com.google.com/", "https://evil.com.google.com")]);
    expect(linkify(`a${ZWNJ}b`)).toEqual([t("ab")]);
  });

  it("keeps joiners between other characters, which emoji and Indic scripts need", () => {
    const technologist = `👩${ZWJ}💻`;
    const conjunct = `क्${ZWJ}ष`;
    expect(parseRichText(`${technologist} ${conjunct}`)).toEqual([para(`${technologist} ${conjunct}`)]);
  });

  it("removes joiners inside a web address even between other characters, so none ends a link part way", () => {
    expect(linkify(`https://acme.io/क्${ZWJ}ष now`)).toEqual([a("https://acme.io/%E0%A4%95%E0%A5%8D%E0%A4%B7", "https://acme.io/क्ष"), t(" now")]);
    expect(linkify(`https://acme.io/क्${ZWNJ}ष`)).toEqual([a("https://acme.io/%E0%A4%95%E0%A5%8D%E0%A4%B7", "https://acme.io/क्ष")]);
    // Not "https://例" linked and "子.com" left after it: the joiner goes, and a host beyond ASCII is never linked.
    expect(linkify(`https://例${ZWJ}子.com`)).toEqual([t("https://例子.com")]);
    // Outside the address, the same joiner stays.
    expect(linkify(`क्${ZWJ}ष https://acme.io`)).toEqual([t(`क्${ZWJ}ष `), a("https://acme.io/", "https://acme.io")]);
  });
});

describe("linkify", () => {
  it("links http and https in any case, showing the address as written", () => {
    expect(linkify("HTTPS://EXAMPLE.COM/Path")).toEqual([a("https://example.com/Path", "HTTPS://EXAMPLE.COM/Path")]);
    expect(linkify("Http://example.com")).toEqual([a("http://example.com/", "Http://example.com")]);
    expect(linkify("See https://example.com/ü now")).toEqual([t("See "), a("https://example.com/%C3%BC", "https://example.com/ü"), t(" now")]);
  });

  // The link shows the address as written but goes to URL's punycode, so the written host has to be the one it goes to.
  it("leaves an address whose host isn't written in ASCII as text, whole", () => {
    const fractionSlash = char(0x2044);
    for (const text of [
      // A subdomain of evil.net that reads as accounts.google.com with a path.
      `https://accounts.google.com${fractionSlash}signin.evil.net`,
      `https://accounts.google.com${char(0x2215)}signin.evil.net/x`,
      // Cyrillic letters that look like "apple".
      "https://аррӏе.com/careers",
      // A right-to-left host shows its numeric path first: https://192.168.1.1/...
      "https://אאא.קום/192.168.1.1",
      "https://exämple.com/ü",
      "https://ａｃｍｅ.io",
    ]) {
      expect(linkify(`Apply at ${text} today`)).toEqual([t(`Apply at ${text} today`)]);
    }
    // Beyond ASCII after the host is fine, and so is an ASCII host with a port.
    expect(linkify("https://acme.io:8443/जॉब्स?q=ü#café")).toEqual([a("https://acme.io:8443/%E0%A4%9C%E0%A5%89%E0%A4%AC%E0%A5%8D%E0%A4%B8?q=%C3%BC#caf%C3%A9", "https://acme.io:8443/जॉब्स?q=ü#café")]);
  });

  it("trims punctuation that ends the sentence", () => {
    for (const tail of [".", ",", ";", ":", "!", "?", "*", "_", "!?.", "..."]) {
      expect(linkify(`Go to https://acme.io/jobs${tail}`)).toEqual([t("Go to "), a("https://acme.io/jobs"), t(tail)]);
    }
    expect(linkify("*https://acme.io*")).toEqual([t("*"), a("https://acme.io/", "https://acme.io"), t("*")]);
    expect(linkify(`"https://acme.io" and <https://acme.io>`)).toEqual([
      t('"'),
      a("https://acme.io/", "https://acme.io"),
      t('" and <'),
      a("https://acme.io/", "https://acme.io"),
      t(">"),
    ]);
  });

  it("ends an address at punctuation word processors, phone keyboards and other scripts write against it", () => {
    // Curly quotes and apostrophes, as Google Docs, Word and iOS type them.
    expect(linkify("Apply at “https://acme.io/careers”.")).toEqual([t("Apply at “"), a("https://acme.io/careers"), t("”.")]);
    expect(linkify("‘https://acme.io/a’")).toEqual([t("‘"), a("https://acme.io/a"), t("’")]);
    expect(linkify("See https://acme.io’s jobs")).toEqual([t("See "), a("https://acme.io/", "https://acme.io"), t("’s jobs")]);
    expect(linkify("«https://acme.io/a» ‹https://acme.io/b›")).toEqual([t("«"), a("https://acme.io/a"), t("» ‹"), a("https://acme.io/b"), t("›")]);
    // An em dash or CJK punctuation with no space after the address.
    expect(linkify("https://acme.io—apply now")).toEqual([a("https://acme.io/", "https://acme.io"), t("—apply now")]);
    expect(linkify("请访问https://acme.io/jobs，谢谢。")).toEqual([t("请访问"), a("https://acme.io/jobs"), t("，谢谢。")]);
    expect(linkify("详见「https://acme.io/a」（招聘）")).toEqual([t("详见「"), a("https://acme.io/a"), t("」（招聘）")]);
    // Sentence punctuation at the end: the ellipsis, the en dash, the Hindi danda, and Arabic and Urdu marks.
    for (const tail of ["…", "–", "।", "॥", "،", "؛", "؟", "۔", "…”"]) {
      expect(linkify(`https://acme.io/jobs${tail}`)).toEqual([a("https://acme.io/jobs"), t(tail)]);
    }
    // An en dash inside the address belongs to it, as in Wikipedia's titles.
    const war = "https://en.wikipedia.org/wiki/Mexican–American_War";
    expect(linkify(war)).toEqual([a("https://en.wikipedia.org/wiki/Mexican%E2%80%93American_War", war)]);
  });

  it("keeps brackets that belong to the address and drops ones that don't", () => {
    const wiki = "https://en.wikipedia.org/wiki/Rust_(programming_language)";
    expect(linkify(wiki)).toEqual([a(wiki)]);
    expect(linkify(`(see ${wiki})`)).toEqual([t("(see "), a(wiki), t(")")]);
    expect(linkify(`(see ${wiki}).`)).toEqual([t("(see "), a(wiki), t(").")]);
    expect(linkify("(https://acme.io/jobs)")).toEqual([t("("), a("https://acme.io/jobs"), t(")")]);
    expect(linkify("[https://acme.io/a]")).toEqual([t("["), a("https://acme.io/a"), t("]")]);
    expect(linkify("{https://acme.io/a}")).toEqual([t("{"), a("https://acme.io/a"), t("}")]);
    expect(linkify("https://acme.io/a[1]")).toEqual([a("https://acme.io/a[1]")]);
  });

  it("never links another scheme", () => {
    for (const text of ["javascript:alert(1)", "JaVaScRiPt:alert(document.cookie)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox", "ftp://files.acme.io", "file:///etc/passwd"]) {
      expect(links(linkify(text))).toEqual([]);
    }
    expect(linkify("javascript:https://acme.io")).toEqual([t("javascript:"), a("https://acme.io/", "https://acme.io")]);
  });

  it("leaves an address with a user name or password as text, whole", () => {
    expect(linkify("https://google.com@evil.com")).toEqual([t("https://google.com@evil.com")]);
    expect(linkify("Login at https://user:pass@acme.io/x today")).toEqual([t("Login at https://user:pass@acme.io/x today")]);
    expect(linkify("https://:pass@acme.io")).toEqual([t("https://:pass@acme.io")]);
    expect(linkify("https://google.com:@evil.com")).toEqual([t("https://google.com:@evil.com")]);
  });

  it("links an @ in the path, which names no user", () => {
    expect(linkify("https://medium.com/@acme/post")).toEqual([a("https://medium.com/@acme/post")]);
  });

  it("leaves what URL can't parse, or that has no host, as text", () => {
    expect(linkify("https://.")).toEqual([t("https://.")]);
    expect(linkify("http://")).toEqual([t("http://")]);
    expect(linkify("https://exa mple.com")).toEqual([a("https://exa/", "https://exa"), t(" mple.com")]);
    expect(links(linkify("https://[::1"))).toEqual([]);
  });

  it("links an address of up to 2048 characters and no longer", () => {
    const base = "https://acme.io/";
    const longest = base + "a".repeat(2048 - base.length);
    expect(linkify(longest)).toEqual([a(longest)]);
    expect(linkify(`${longest}a`)).toEqual([t(`${longest}a`)]);
    // The limit is on what's written as well as where it goes: this one's href is just https://acme.io/x.
    const dotted = `${base}${"./".repeat(1100)}x`;
    expect(linkify(dotted)).toEqual([t(dotted)]);
  });

  it("links bare email addresses with mailto:", () => {
    expect(linkify("Write to jobs@acme.io.")).toEqual([t("Write to "), a("mailto:jobs@acme.io", "jobs@acme.io"), t(".")]);
    expect(linkify("(first.last+jobs@mail.acme.co.uk)")).toEqual([t("("), a("mailto:first.last+jobs@mail.acme.co.uk", "first.last+jobs@mail.acme.co.uk"), t(")")]);
    expect(linkify("a@b.io, c@d.io")).toEqual([a("mailto:a@b.io", "a@b.io"), t(", "), a("mailto:c@d.io", "c@d.io")]);
  });

  it("leaves things that only look like email addresses as text", () => {
    for (const text of ["user@host", "@handle", "name@", "a..b@acme.io", "a.@acme.io", "x@-acme.io", "x@acme.1", "x@acme.c"]) {
      expect(links(linkify(text))).toEqual([]);
    }
  });

  // A mail app decodes the address it's given: "%2C" would add a recipient and "%40" make another address.
  it("never puts a % in an email link, so the link goes only to the address it shows", () => {
    expect(linkify("x%2Cy@evil.io")).toEqual([t("x%"), a("mailto:2Cy@evil.io", "2Cy@evil.io")]);
    expect(linkify("Send your CV to cv%40gmai1.com%2Chr@acme.io")).toEqual([t("Send your CV to cv%40gmai1.com%"), a("mailto:2Chr@acme.io", "2Chr@acme.io")]);
    expect(linkify("a%41@b.io")).toEqual([t("a%"), a("mailto:41@b.io", "41@b.io")]);
    for (const text of ["x%2Cy@evil.io", "cv%40gmai1.com%2Chr@acme.io", "%@acme.io"]) {
      for (const link of links(linkify(text))) {
        expect(link.href).not.toContain("%");
        expect(link.href).toBe(`mailto:${link.text}`);
      }
    }
  });

  it("finds web addresses first, so an email next to one is linked separately and never inside it", () => {
    expect(linkify("Mail hr@acme.io or https://acme.io/jobs, thanks")).toEqual([
      t("Mail "),
      a("mailto:hr@acme.io", "hr@acme.io"),
      t(" or "),
      a("https://acme.io/jobs"),
      t(", thanks"),
    ]);
    expect(linkify("https://acme.io hr@acme.io")).toEqual([a("https://acme.io/", "https://acme.io"), t(" "), a("mailto:hr@acme.io", "hr@acme.io")]);
    // A rejected address stays text whole: no email is picked out of it.
    expect(linkify("https://google.com@evil.com")).toEqual([t("https://google.com@evil.com")]);
  });

  it("joins neighbouring text into one run", () => {
    const out = linkify("a@ b@ c https://. d");
    expect(out).toEqual([t("a@ b@ c https://. d")]);
  });
});

describe("plainExcerpt", () => {
  const text = "We're hiring.\n- Node.js\n- Postgres\n\n1. Apply at https://acme.io/jobs";

  it("puts blocks on one line, joining list items with ' · '", () => {
    expect(plainExcerpt(text, 200)).toBe("We're hiring. Node.js · Postgres Apply at https://acme.io/jobs");
    expect(plainExcerpt("Line one\nLine two", 200)).toBe("Line one Line two");
    expect(plainExcerpt(null, 10)).toBe("");
  });

  it("cuts between words and ends with an ellipsis, within the limit", () => {
    const out = plainExcerpt(text, 24);
    expect(out).toBe("We're hiring. Node.js…");
    expect(out.length).toBeLessThanOrEqual(24);
    expect(plainExcerpt(text, 34)).toBe("We're hiring. Node.js · Postgres…");
  });

  it("cuts inside a word only when the last space is too far back", () => {
    const out = plainExcerpt(`See ${"x".repeat(100)}`, 20);
    expect(out).toBe(`See ${"x".repeat(15)}…`);
    expect(out.length).toBe(20);
  });

  it("never splits a character in two", () => {
    const out = plainExcerpt("😀".repeat(10), 6);
    expect(out).toBe("😀😀…");
    expect(Array.from(out).every((c) => c === "😀" || c === "…")).toBe(true);
  });
});

describe("textDirection", () => {
  it("reads right to left when the first letter is Hebrew, Arabic or Urdu", () => {
    expect(textDirection("שלום")).toBe("rtl");
    expect(textDirection("مرحبا")).toBe("rtl");
    expect(textDirection("اردو میں تفصیل")).toBe("rtl");
  });

  it("skips digits, punctuation and emoji to find the first letter, as dir=\"auto\" does", () => {
    expect(textDirection("2024 — שלום")).toBe("rtl");
    expect(textDirection("😀 «مرحبا» hello")).toBe("rtl");
    expect(textDirection("(1) hello مرحبا")).toBe("ltr");
    expect(textDirection("١٢٣ hello")).toBe("ltr");
  });

  it("reads left to right for other scripts and for text with no letters", () => {
    for (const text of ["Hello", "Ünïcode", "Привет", "नमस्ते", "こんにちは", "你好", "안녕", "", "123 · !?"]) {
      expect(textDirection(text)).toBe("ltr");
    }
  });
});

describe("inlineText", () => {
  it("joins a line's text and links as written", () => {
    expect(inlineText(linkify("Mail hr@acme.io or https://acme.io/jobs."))).toBe("Mail hr@acme.io or https://acme.io/jobs.");
  });
});

describe("RICH_TEXT_HINT", () => {
  it("tells people how to make a list", () => {
    expect(RICH_TEXT_HINT).toBe("Start a line with - for a bullet point. Links become clickable.");
  });
});

describe("performance", () => {
  it("parses a 5000-character description quickly", () => {
    const description = Array.from(
      { length: 100 },
      (_, i) => (i % 5 === 0 ? `Team ${i}: see https://acme.io/t/${i} or hr${i}@acme.io` : `- Item ${i} (${"x".repeat(i % 7)})`),
    )
      .join("\n")
      .padEnd(5000, " word")
      .slice(0, 5000);
    expect(description.length).toBe(5000);
    let blocks: RichBlock[] = [];
    expect(timed(() => (blocks = parseRichText(description)))).toBeLessThan(100);
    expect(blocks.flatMap((b) => (b.type === "list" ? b.items : b.lines)).flat().filter((i) => i.type === "link")).toHaveLength(40);
  });

  // Each of these makes a quadratic or backtracking matcher take seconds at this length.
  it.each([
    ["one long address of brackets", `https://acme.io/${"(".repeat(25_000)}${")".repeat(25_001)}`],
    ["many @ signs", "a@".repeat(25_000)],
    ["a long local part with no @", "a.".repeat(25_000)],
    ["address prefixes", "http:/".repeat(10_000)],
    ["a bullet followed by spaces", `-${" ".repeat(50_000)}`],
    ["trailing punctuation", `https://acme.io/${".".repeat(50_000)}`],
    ["invisible characters", `${ZWJ}a`.repeat(25_000)],
    ["joiners inside an address", `https://acme.io/${`例${ZWJ}`.repeat(25_000)}`],
    ["a long host beyond ASCII", `https://${"例".repeat(50_000)}`],
  ])("stays linear on %s", (_name, input) => {
    expect(input.length).toBeGreaterThanOrEqual(50_000);
    expect(timed(() => parseRichText(input))).toBeLessThan(500);
  });
});
