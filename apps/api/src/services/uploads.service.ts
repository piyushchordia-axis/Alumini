import type { UploadPurpose } from "@illuminize/shared";
import type { AppContext } from "../context";
import type { DbClient } from "../db/client";
import { AppError } from "../lib/errors";
import { IMAGE_EXTENSIONS, processImage, sniffImageType } from "../lib/images";
import { afterCommit, runInTransaction } from "../lib/transaction";
import { listMembershipsForUser, lockMembershipAvatarUrl } from "../repositories/memberships.repo";
import { deleteUploadById, findUploadByKey, insertUpload, isPhotoShown, listAvatarUploadKeys, listUnshownAvatarKeys } from "../repositories/uploads.repo";

/** How long a photo may sit unsaved (picked in a form that was never submitted) before the sweep deletes it. */
export const UNSAVED_AVATAR_GRACE_MS = 2 * 24 * 60 * 60_000;
const SWEEP_BATCH = 200;
const SWEEP_MAX_BATCHES = 10;

/** Processes an uploaded image (see processImage), stores it and records it in the ledger. */
export async function storeUpload(
  ctx: AppContext,
  input: { tenantId: string; userId: string; buffer: Buffer; purpose: UploadPurpose },
): Promise<{ url: string }> {
  const mime = sniffImageType(input.buffer);
  if (!mime) throw new AppError(415, "UNSUPPORTED_MEDIA", "The file is not a valid JPEG, PNG or WebP image");
  const image = await processImage(input.buffer, mime, input.purpose);
  const stored = await ctx.storage.save({ tenantId: input.tenantId, buffer: image.buffer, mime: image.mime, extension: IMAGE_EXTENSIONS[image.mime] });
  try {
    await insertUpload(ctx.db, {
      tenantId: input.tenantId,
      userId: input.userId,
      storageKey: stored.key,
      purpose: input.purpose,
      contentType: image.mime,
      byteSize: image.buffer.length,
    });
  } catch (err) {
    // A file nothing records could never be cleaned up.
    await deleteFile(ctx, stored.key);
    throw err;
  }
  return { url: stored.url };
}

/**
 * The profile photo rules, for a change of membership `membershipId`'s photo to `next` (undefined leaves the photo
 * alone), inside the transaction that saves it; null `membershipId` is a membership about to be created. A new photo
 * must be an avatar uploaded to this institution by one of `uploaderIds`: the member, or the admin making the edit.
 * That keeps out third-party URLs, which would log the address of everyone who opens the directory, and photos of
 * other people. An unchanged value always passes, so photos saved before this rule, or before a switch of storage
 * provider, survive every later edit. Once the change commits, the photo it replaces is deleted if nothing shows it.
 *
 * The photo saved now is read with the membership's row locked, not taken from what the request loaded earlier, and
 * the new photo's ledger row is locked for share until the change commits. Together with the deletion's lock (see
 * removeAvatarsIfUnused) that stops a concurrent save from showing a photo that is being deleted: either the deletion
 * waits and then sees the photo in use, or the save waits and then finds the photo gone and is refused.
 */
export async function applyAvatarChange(
  ctx: AppContext,
  tx: DbClient,
  tenantId: string,
  change: { membershipId: string | null; next: string | null | undefined; uploaderIds: string[] },
): Promise<void> {
  const { membershipId, next, uploaderIds } = change;
  if (next === undefined) return;
  const previous = membershipId ? ((await lockMembershipAvatarUrl(tx, tenantId, membershipId)) ?? null) : null;
  if (next === previous) return;
  if (next !== null) {
    const key = ctx.storage.keyFromUrl(next);
    const upload = key ? await findUploadByKey(tx, key, { lock: "share" }) : undefined;
    const own = !!upload && upload.tenantId === tenantId && upload.purpose === "avatar" && !!upload.userId && uploaderIds.includes(upload.userId);
    if (!own) throw AppError.badRequest("The profile photo must be uploaded here", [{ path: "avatarUrl", message: "Upload a photo from your device" }]);
  }
  const replaced = previous ? ctx.storage.keyFromUrl(previous) : null;
  if (replaced) await afterCommit(ctx, tx, () => removeAvatarsIfUnused(ctx, [replaced]));
}

/**
 * For account deletion, before the memberships go: the keys of every avatar the user uploaded and of the photos their
 * memberships show (an admin may have uploaded one). Pass them to removeAvatarsIfUnused once the deletion commits.
 */
export async function avatarKeysOfUser(ctx: AppContext, db: DbClient, userId: string): Promise<string[]> {
  const shown = (await listMembershipsForUser(db, userId)).flatMap(({ membership }) => {
    const key = membership.avatarUrl ? ctx.storage.keyFromUrl(membership.avatarUrl) : null;
    return key ? [key] : [];
  });
  return listAvatarUploadKeys(db, userId, shown);
}

/**
 * Deletes each avatar upload no membership shows any more, file and ledger row, and returns how many went. Runs after
 * the change that let go of them has committed, and never throws: a photo left behind is only wasted space.
 *
 * Each runs in its own transaction that locks the ledger row first, then checks the memberships in a separate
 * statement, which under READ COMMITTED sees whatever a save holding the row (see applyAvatarChange) committed while
 * this one waited. The file goes before the row, so if storage refuses, the row stays and the sweep tries again later.
 * A CDN in front of S3 may keep serving a deleted photo until its cached copy expires (objects are cached as immutable).
 */
export async function removeAvatarsIfUnused(ctx: AppContext, keys: string[]): Promise<number> {
  let removed = 0;
  for (const key of keys) {
    try {
      const gone = await runInTransaction(ctx, async (tx) => {
        const upload = await findUploadByKey(tx, key, { lock: "update" });
        if (!upload || upload.purpose !== "avatar") return false;
        if (await isPhotoShown(tx, upload.tenantId, key)) return false;
        await ctx.storage.delete(key);
        await deleteUploadById(tx, upload.id);
        return true;
      });
      if (gone) removed++;
    } catch (err) {
      ctx.logger.warn({ err, key }, "Could not remove an unused profile photo");
    }
  }
  return removed;
}

/**
 * The background sweep: deletes avatar uploads older than UNSAVED_AVATAR_GRACE_MS that no profile shows. They are
 * photos picked in a form that was never saved (or picked again before saving), and ones a failed clean-up left.
 */
export async function sweepUnusedAvatars(ctx: AppContext, now = new Date()): Promise<{ removed: number }> {
  const before = new Date(now.getTime() - UNSAVED_AVATAR_GRACE_MS);
  let removed = 0;
  for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch++) {
    const keys = await listUnshownAvatarKeys(ctx.db, before, SWEEP_BATCH);
    const gone = await removeAvatarsIfUnused(ctx, keys);
    removed += gone;
    // A short batch was the last; one where nothing went (storage refusing) would only repeat itself.
    if (keys.length < SWEEP_BATCH || gone === 0) break;
  }
  if (removed > 0) ctx.logger.info({ removed }, "Removed unsaved profile photos");
  return { removed };
}

async function deleteFile(ctx: AppContext, key: string): Promise<void> {
  try {
    await ctx.storage.delete(key);
  } catch (err) {
    ctx.logger.warn({ err, key }, "Could not delete a stored file");
  }
}
