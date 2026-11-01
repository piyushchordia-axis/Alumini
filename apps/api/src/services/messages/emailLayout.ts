/** Escapes text for HTML element content and double-quoted attributes. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Plain text to HTML paragraphs (escaped). */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** A button-styled link; `href` must already be a trusted absolute URL (built from WEB_APP_URL). */
export function emailButton(href: string, label: string, color = "#1d4ed8"): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${escapeHtml(color)};color:#ffffff;font-weight:600;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

/**
 * The shared email frame: inline styles only (mail clients drop <style>), a single 600px column, no images. Every
 * argument except `bodyHtml` and `footerHtml` is plain text; those two must be built from escaped parts.
 */
export function emailLayout(opts: { title: string; bodyHtml: string; footerHtml?: string; color?: string; preheader?: string }): string {
  const color = opts.color ?? "#1d4ed8";
  return [
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.title)}</title></head>`,
    `<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">`,
    opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(opts.preheader)}</div>` : "",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border-top:4px solid ${escapeHtml(color)}">`,
    `<tr><td style="padding:28px 28px 8px;font-size:15px;line-height:1.55">`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(opts.title)}</h1>`,
    opts.bodyHtml,
    `</td></tr>`,
    `<tr><td style="padding:8px 28px 24px;font-size:12px;line-height:1.5;color:#64748b">${opts.footerHtml ?? "Sent by Illuminize."}</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join("");
}
