import { validateHeaderValue } from "node:http";
import { describe, expect, it } from "vitest";
import { contentDisposition } from "../../src/lib/contentDisposition";

/** The name a browser reads from filename* (RFC 8187). */
function extName(header: string): string {
  const match = /filename\*=UTF-8''([^;]*)$/.exec(header);
  if (!match) throw new Error(`no filename* in ${header}`);
  return decodeURIComponent(match[1]!);
}

const fallback = (header: string) => /filename="([^"]*)"/.exec(header)?.[1];

describe("contentDisposition", () => {
  it("is the bare type with no name", () => {
    expect(contentDisposition("inline")).toBe("inline");
    expect(contentDisposition("attachment", null)).toBe("attachment");
    expect(contentDisposition("attachment", "  ")).toBe("attachment");
  });

  it("gives an ASCII name both ways", () => {
    expect(contentDisposition("attachment", "notes.pdf")).toBe(`attachment; filename="notes.pdf"; filename*=UTF-8''notes.pdf`);
    expect(contentDisposition("inline", "Q3 report (final).pdf")).toBe(`inline; filename="Q3 report (final).pdf"; filename*=UTF-8''Q3%20report%20%28final%29.pdf`);
  });

  it("keeps any script exactly in filename*, with a readable ASCII fallback", () => {
    for (const name of ["Résumé – 2024.pdf", "पाठ्यक्रम.pdf", "履歴書.pdf", "Ünïcödé 🎓.pdf", "it's *done*.pdf"]) {
      const header = contentDisposition("attachment", name);
      expect(extName(header), name).toBe(name);
      expect(fallback(header), name).toMatch(/^[\x20-\x7e]+$/);
      expect(() => validateHeaderValue("Content-Disposition", header)).not.toThrow();
    }
    expect(fallback(contentDisposition("attachment", "Résumé – 2024.pdf"))).toBe("Resume _ 2024.pdf");
    expect(contentDisposition("attachment", "it's *done*.pdf")).toContain("filename*=UTF-8''it%27s%20%2Adone%2A.pdf");
  });

  it("can't be broken out of: no quote, backslash, line break or extra parameter gets through", () => {
    const header = contentDisposition("attachment", 'evil".pdf\r\nSet-Cookie: a=1; filename="x\\y%41.pdf');
    expect(() => validateHeaderValue("Content-Disposition", header)).not.toThrow();
    expect(header).not.toMatch(/[\r\n]/);
    expect(fallback(header)).toBe("evil_.pdfSet-Cookie: a=1; filename=_x_y_41.pdf");
    expect(header.split('"').length).toBe(3);
    expect(extName(header)).toBe('evil".pdfSet-Cookie: a=1; filename="x\\y%41.pdf');
  });

  it("drops invisible characters that could disguise an extension, and copes with broken text", () => {
    const header = contentDisposition("attachment", "invoice‮fdp.exe");
    expect(extName(header)).toBe("invoicefdp.exe");
    expect(() => contentDisposition("attachment", "half\uD800.pdf")).not.toThrow();
    expect(extName(contentDisposition("attachment", "half\uD800.pdf"))).toBe("half�.pdf");
  });
});
