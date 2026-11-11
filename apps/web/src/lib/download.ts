/** Saves a downloaded file (a CSV export) through a temporary link. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Downloads what a signed link points at, such as a chat file, by following it from a temporary link in this tab: the
 * server sends it as an attachment, so the page stays where it is. No new tab, and no referrer.
 */
export function downloadFromUrl(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  // Same-origin, this asks for a download under the server's own name; another origin's attachment header does the same.
  a.download = "";
  a.rel = "noreferrer";
  a.referrerPolicy = "no-referrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
