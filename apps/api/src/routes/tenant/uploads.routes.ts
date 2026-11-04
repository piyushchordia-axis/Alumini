import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES, uploadQuerySchema } from "@illuminize/shared";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import { byUser, rateLimit } from "../../middleware/rateLimit";
import { ok, route } from "../../middleware/validate";
import { keys } from "../../redis/keys";
import { findMyInvitation } from "../../services/invitations.service";
import { storeUpload } from "../../services/uploads.service";

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
 * registration), people registering where self-registration is open or who hold an open invitation (a photo before the
 * membership exists), and Illuminize staff. Suspended members and other strangers to a closed institution may not.
 */
function canUpload(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    try {
      const m = req.membership;
      if (req.auth?.isPlatformAdmin) return next();
      if (m) return m.status === "SUSPENDED" ? next(AppError.forbidden("Your membership is suspended", "MEMBERSHIP_SUSPENDED")) : next();
      if (req.tenantCtx?.settings.allowSelfRegistration) return next();
      if (req.auth && (await findMyInvitation(ctx, req.tenantCtx!, req.auth.userId))) return next();
      next(AppError.forbidden("You are not a member of this institution", "NOT_A_MEMBER"));
    } catch (err) {
      next(err);
    }
  };
}

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

/**
 * Checks `?purpose=` before anything is counted or the file is read, so a request the handler would refuse (a client
 * newer than this API, say) costs neither the member's hourly uploads nor the institution's daily ones.
 */
const validQuery: RequestHandler = (req, _res, next) => {
  const parsed = uploadQuerySchema.safeParse(req.query ?? {});
  next(parsed.success ? undefined : parsed.error);
};

export function uploadRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.post(
    "/uploads",
    canUpload(ctx),
    validQuery,
    rateLimit(ctx, { bucket: "uploads", limit: 20, windowSec: 3600, keyFn: byUser }),
    tenantDailyQuota(ctx),
    upload.single("file"),
    route({ query: uploadQuerySchema }, async ({ req, res, query }) => {
      const file = req.file;
      if (!file) throw AppError.badRequest("Attach an image in the 'file' field");
      const stored = await storeUpload(ctx, { tenantId: req.tenantCtx!.tenant.id, userId: req.auth!.userId, buffer: file.buffer, purpose: query.purpose });
      ok(res, stored, 201);
    }),
  );
  return router;
}
