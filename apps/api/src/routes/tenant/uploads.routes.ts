import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@illuminize/shared";
import { Router } from "express";
import multer from "multer";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import { IMAGE_EXTENSIONS, sniffImageType } from "../../lib/images";
import { byUser, rateLimit } from "../../middleware/rateLimit";
import { ok } from "../../middleware/validate";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_IMAGE_MIME as readonly string[]).includes(file.mimetype)) cb(null, true);
    else cb(new AppError(415, "UNSUPPORTED_MEDIA", "Only JPEG, PNG and WebP images are allowed"));
  },
});

/** Any signed-in user may upload inside a tenant (needed for avatars during registration); rate limited per user. */
export function uploadRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.post(
    "/uploads",
    rateLimit(ctx, { bucket: "uploads", limit: 20, windowSec: 3600, keyFn: byUser }),
    upload.single("file"),
    async (req, res, next) => {
      try {
        const file = req.file;
        if (!file) throw AppError.badRequest("Attach an image in the 'file' field");
        const mime = sniffImageType(file.buffer);
        if (!mime) throw new AppError(415, "UNSUPPORTED_MEDIA", "The file is not a valid JPEG, PNG or WebP image");
        const stored = await ctx.storage.save({ tenantId: req.tenantCtx!.tenant.id, buffer: file.buffer, mime, extension: IMAGE_EXTENSIONS[mime] });
        ok(res, { url: stored.url }, 201);
      } catch (err) {
        next(err);
      }
    },
  );
  return router;
}
