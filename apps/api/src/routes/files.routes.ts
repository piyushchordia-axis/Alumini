import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import { findChatAttachmentById } from "../repositories/chatAttachments.repo";
import { LocalPrivateStorage } from "../services/storage";
import { PRIVATE_KEY_PATTERN, privateCopy } from "../services/storage/PrivateStorage";

/**
 * What a chat file is sent with: never stored by a browser or a proxy, never read as another type, and, opened as a page,
 * unable to run anything or reach this origin. No ETag or Last-Modified, which no-store would make useless anyway.
 */
const PRIVATE_FILE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
} as const;

const isMissing = (err: unknown) => (err as { code?: unknown } | null)?.code === "ENOENT";
const isClientGone = (err: unknown) => (err as { code?: unknown } | null)?.code === "ERR_STREAM_PREMATURE_CLOSE";

/**
 * Chat photos and files on local disk, at the links LocalPrivateStorage signs. Outside /api/v1 because an image or a
 * download opens it with no Authorization header: the token is the only authority. It names an attachment and nothing
 * about the file, and the attachment is looked up again on every request, so a deleted one stops opening at once. With S3
 * the links are presigned GETs on the bucket, and this answers 404.
 */
export function filesRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get("/:token", async (req, res, next) => {
    const storage = ctx.privateStorage;
    if (!(storage instanceof LocalPrivateStorage)) return next();
    let file: FileHandle | null = null;
    try {
      const claim = storage.verify(req.params.token);
      if (!claim) throw AppError.forbidden("This link has expired");
      const row = await findChatAttachmentById(ctx.db, claim.attachmentId);
      const copy = row ? privateCopy(row, claim.variant) : null;
      if (!row || !copy) throw AppError.notFound();
      if (!PRIVATE_KEY_PATTERN.test(copy.key)) {
        ctx.logger.error({ attachmentId: row.id }, "A chat attachment has an invalid storage key");
        throw AppError.notFound();
      }
      try {
        file = await open(join(storage.root, copy.key), "r");
      } catch (err) {
        if (!isMissing(err)) throw err;
        ctx.logger.warn({ attachmentId: row.id }, "A chat attachment's file is missing");
        throw AppError.notFound();
      }
      const { size } = await file.stat();
      res.set({ ...PRIVATE_FILE_HEADERS, "Content-Type": copy.contentType, "Content-Disposition": copy.disposition, "Content-Length": String(size) });
      if (req.method === "HEAD") return void res.end();
      const stream = file.createReadStream();
      file = null; // the stream closes it
      await pipeline(stream, res);
    } catch (err) {
      if (isClientGone(err)) return;
      // An error that is still to be answered goes out as the JSON it is, not labelled as the file.
      if (!res.headersSent) for (const name of ["Content-Type", "Content-Disposition", "Content-Length"]) res.removeHeader(name);
      next(err);
    } finally {
      await file?.close();
    }
  });
  return router;
}
