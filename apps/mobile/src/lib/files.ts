import { withBom } from "@illuminize/shared";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File as FsFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

/** A text file the admin picked: its name, and what it says. */
export interface PickedTextFile {
  name: string;
  text: string;
}

/** The types a CSV can come as: Android often labels one text/plain, and Excel's own as application/vnd.ms-excel. */
export const CSV_FILE_TYPES = ["text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel", ".csv"] as const;

/** Thrown for a picked file that can't be read as text, or is over the size given. */
export class UnreadableFileError extends Error {
  constructor() {
    super("Couldn't read that file. Save it as CSV and try again.");
    this.name = "UnreadableFileError";
  }
}

/**
 * Lets the admin pick one text file (a CSV) and reads it, or null if they cancel. `accept` lists its types; an extension
 * (".csv") counts on the web only, as the phones' pickers go by type. On a phone the picked file is read from a copy in
 * the app's own storage, then the copy is deleted: on Android the picker copies it into the cache (a content:// address
 * can't be read in place); on iOS the system's picker already hands over a copy of its own, in the app's tmp folder, so
 * asking the picker for another would leave that first one behind. On the web it is read from the browser's File.
 * Throws UnreadableFileError when it can't be read or is over `maxBytes`.
 */
export async function pickTextFile(accept: readonly string[], { maxBytes = 5 * 1024 * 1024 }: { maxBytes?: number } = {}): Promise<PickedTextFile | null> {
  const web = Platform.OS === "web";
  const result = await DocumentPicker.getDocumentAsync({ type: web ? [...accept] : accept.filter((t) => !t.startsWith(".")), copyToCacheDirectory: Platform.OS !== "ios", multiple: false, base64: false });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  try {
    if (asset.size !== undefined && asset.size > maxBytes) throw new UnreadableFileError();
    if (web) {
      if (!asset.file) throw new UnreadableFileError();
      return { name: asset.name, text: await asset.file.text() };
    }
    const copy = new FsFile(asset.uri);
    if (copy.size > maxBytes) throw new UnreadableFileError();
    return { name: asset.name, text: await copy.text() };
  } catch (err) {
    throw err instanceof UnreadableFileError ? err : new UnreadableFileError();
  } finally {
    forget(asset.uri, web);
  }
}

/** Best effort: the picker's object address on the web, its copy on a phone. The system clears the cache anyway. */
function forget(uri: string, web: boolean) {
  try {
    if (web) URL.revokeObjectURL(uri);
    else new FsFile(uri).delete();
  } catch {
    // Already gone.
  }
}

/** What iOS calls a file's type, where its MIME type alone may not be enough to offer the right apps. */
const UTI: Readonly<Record<string, string>> = { "text/csv": "public.comma-separated-values-text" };

/** Where saveFile puts what it shares, in the app's cache: only ever the latest file. */
const SHARED_FILES = "shared-files";

/**
 * Saves `data` as a file called `name`: on the web a download, and on a phone a file in the app's cache, handed to the
 * share sheet (Save to Files, Drive, Mail, WhatsApp). A CSV gets its byte order mark, so Excel reads names in any script.
 * Resolves once the sheet has closed on a phone; throws when the phone can't share files.
 *
 * A file shared before is deleted on the next save rather than when the sheet closes: on Android the app it went to
 * (Drive, say) may read it after that. So the folder holds the latest file only, and an export of members' numbers
 * doesn't stay in the cache once another file is saved.
 */
export async function saveFile(name: string, data: string, mime: string): Promise<void> {
  const base = mime.split(";")[0]!.trim();
  const text = base === "text/csv" ? withBom(data) : data;
  // The name may come from a server's Content-Disposition: no folders in it.
  const fileName = name.replace(/[\\/:*?"<>|]+/g, "_") || "download";
  if (Platform.OS === "web") return download(fileName, text, mime);
  const folder = new Directory(Paths.cache, SHARED_FILES);
  try {
    if (folder.exists) folder.delete();
  } catch {
    // Best effort: the save goes ahead, and the next one tries again.
  }
  folder.create({ intermediates: true, idempotent: true });
  const file = new FsFile(folder, fileName);
  file.create({ overwrite: true });
  await file.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error("This device can't share files.");
  await Sharing.shareAsync(file.uri, { mimeType: base, UTI: UTI[base], dialogTitle: fileName });
}

/** The web's download, as the web app's saveBlob: through a temporary link. */
function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime.includes("charset") ? mime : `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A PDF picked for a chat message: its copy on the phone, or on the web build the browser's own File, and what it is. */
export interface PickedChatFile {
  /** The copy in the app's own storage on a phone; "" on the web build. */
  uri: string;
  name: string;
  type: string;
  size: number | null;
  /** The web build's File, which uploads as it is. */
  file?: File;
}

/**
 * Lets the member pick PDFs for a chat message, at most `limit` where the picker can say so (the web build's can't, and the
 * tray turns the rest away), or none if they cancel. As with pickTextFile, a phone reads each from a copy in the app's own
 * storage, here kept until its upload is done or it's taken out of the tray (discardPickedFile). Its size is read from the
 * copy, since a picker may not know it.
 */
export async function pickChatFiles({ limit = 1 }: { limit?: number } = {}): Promise<PickedChatFile[]> {
  const web = Platform.OS === "web";
  const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: Platform.OS !== "ios", multiple: limit > 1, base64: false });
  if (result.canceled) return [];
  const picked: PickedChatFile[] = [];
  for (const asset of result.assets) {
    if (web) {
      // The File is what goes; the picker's object address isn't needed.
      forget(asset.uri, true);
      if (asset.file) picked.push({ uri: "", name: asset.name, type: asset.file.type || asset.mimeType || "", size: asset.file.size, file: asset.file });
      continue;
    }
    let size = asset.size ?? null;
    try {
      size = new FsFile(asset.uri).size;
    } catch {
      // The picker's own figure, or none: the server checks the bytes anyway.
    }
    picked.push({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? "", size });
  }
  return picked;
}

/** Deletes a picked file's copy (on the web build, lets its address go). Best effort, as forget. */
export function discardPickedFile(uri: string) {
  if (uri) forget(uri, Platform.OS === "web");
}

/** Where openPrivateFile puts what it hands over, in the app's cache: only ever the latest file. */
const OPENED_FILES = "chat-files";
const PRIVATE_FILE_UTI: Readonly<Record<string, string>> = { "application/pdf": "com.adobe.pdf", "image/jpeg": "public.jpeg", "image/png": "public.png", "image/webp": "org.webmproject.webp" };

function emptyOpenedFiles(): Directory {
  const folder = new Directory(Paths.cache, OPENED_FILES);
  try {
    if (folder.exists) folder.delete();
  } catch {
    // Best effort: the next open, or sign-out, tries again.
  }
  return folder;
}

/**
 * Opens a chat file or photo from its signed link: on a phone it's downloaded into the app's cache and handed to the share
 * sheet (to open in a PDF reader, save to Files, send on), and on the web build it downloads as the web app's do, from a
 * link in this tab with no referrer. As saveFile does, the folder holds only the latest file, since the app it went to may
 * read it after the sheet closes; forgetOpenedFiles empties it at sign-out. Throws, in words for the member, when it
 * can't be downloaded (an expired link, say) or the phone can't share files.
 */
export async function openPrivateFile(url: string, name: string, mime: string): Promise<void> {
  if (Platform.OS === "web") return downloadFromLink(url);
  const folder = emptyOpenedFiles();
  folder.create({ intermediates: true, idempotent: true });
  const fileName = name.replace(/[\\/:*?"<>|]+/g, "_") || "download";
  let file: FsFile;
  try {
    file = await FsFile.downloadFileAsync(url, new FsFile(folder, fileName), { idempotent: true });
  } catch {
    // The native error can quote the address, a signed link: say what happened instead.
    throw new Error("That couldn't be downloaded. Check your connection, then try again.");
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("This device can't share files.");
  await Sharing.shareAsync(file.uri, { mimeType: mime, UTI: PRIVATE_FILE_UTI[mime], dialogTitle: name });
}

/** Deletes whatever openPrivateFile last handed over, as signing out does. */
export function forgetOpenedFiles() {
  if (Platform.OS !== "web") emptyOpenedFiles();
}

/** The web build's download of a signed link: the server sends it as an attachment, so the page stays where it is. */
function downloadFromLink(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.rel = "noreferrer";
  a.referrerPolicy = "no-referrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
