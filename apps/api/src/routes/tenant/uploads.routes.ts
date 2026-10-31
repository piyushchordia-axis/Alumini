import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@illuminize/shared";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import { IMAGE_EXTENSIONS, sniffImageType } from "../../lib/images";
import { byUser, rateLimit } from "../../middleware/rateLimit";
import { ok } from "../../middleware/validate";
import { keys } from "../../redis/keys";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_IMAGE_MIME as readonly string[]).includes(file.mimetype)) cb(null, true);
    else cb(new AppError(415, "UNSUPPORTED_MEDIA", "Only JPEG, PNG and WebP images are allowed"));
  },
});

/**
 * Who may upload into an institution's storage: its members (approved, or pending/rejected while they fix their
 * registration), people registering where self-registration is open (avatar before the membership exists), and
 * Illuminize staff. Suspended members and strangers to a closed institution may not.
 */
const canUpload: RequestHandler = (req, _res, next) => {
  const m = req.membership;
  if (req.auth?.isPlatformAdmin) return next();
  if (m) return m.status === "SUSPENDED" ? next(AppError.forbidden("Your membership is suspended", "MEMBERSHIP_SUSPENDED")) : next();
  if (req.tenantCtx?.settings.allowSelfRegistration) return next();
  next(AppError.forbidden("You are not a member of this institution", "NOT_A_MEMBER"));
};

/** Per-institution daily cap across all its members. */
function tenantDailyQuota(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const key = keys.uploadsDay(req.tenantCtx!.tenant.id, day);
      const n = await ctx.redis.incr(key);
      if (n === 1) await ctx.redis.expire(key, 86_400 + 3600);
      if (n > ctx.config.UPLOADS_PER_TENANT_DAILY_CAP) {
        ctx.logger.warn({ tenantId: req.tenantCtx!.tenant.id, n }, "Tenant upload quota reached");
        return next(AppError.rateLimited(3600, "This institution has reached today's upload limit. Please try again tomorrow."));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function uploadRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.post(
    "/uploads",
    canUpload,
    rateLimit(ctx, { bucket: "uploads", limit: 20, windowSec: 3600, keyFn: byUser }),
    tenantDailyQuota(ctx),
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
