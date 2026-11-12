import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq } from "drizzle-orm";
import { processImage } from "../lib/images";
import type { Db } from "./client";
import { memberships, tenants, uploads, users } from "./schema";

const PORTRAIT_DIR = join(dirname(fileURLToPath(import.meta.url)), "portraits");

/**
 * First names of the Samaj's women, named and generated. Anyone else gets a man's portrait. The same name always
 * maps the same way, so a re-run gives a member the face they already have.
 */
const WOMEN = new Set([
  "Hetal",
  "Asha",
  "Nisha",
  "Diya",
  "Kavya",
  "Saanvi",
  "Aditi",
  "Riya",
  "Ira",
  "Myra",
  "Anika",
  "Zoya",
  "Sana",
  "Gurleen",
  "Sunita",
  "Ritu",
  "Nandini",
  "Tanvi",
  "Aisha",
  "Maria",
  "Fatima",
  "Smita",
]);

/** A stable file id, so seeding again reuses the photo instead of storing a second copy. */
function portraitId(phone: string): string {
  const h = createHash("sha256").update(`illuminize-samaj-portrait:${phone}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function portraitFiles(kind: "women" | "men"): Promise<string[]> {
  const dir = join(PORTRAIT_DIR, kind);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".jpg")).sort();
  if (names.length === 0) throw new Error(`No portrait files in ${dir}`);
  return names.map((name) => join(dir, name));
}

/**
 * Gives every Shri Gujarati Samaj member who has no photo a dummy portrait, stored like a photo they uploaded:
 * a square JPEG under the upload directory, a ledger row in their name, and `avatarUrl` pointing at it.
 * Members who already have a photo are left as they are. Returns how many photos were added.
 */
export async function seedSamajPortraits(db: Db, storage: { uploadDir: string; publicBaseUrl: string }): Promise<number> {
  const [women, men] = await Promise.all([portraitFiles("women"), portraitFiles("men")]);
  const rows = await db
    .select({
      id: memberships.id,
      tenantId: memberships.tenantId,
      userId: memberships.userId,
      fullName: memberships.fullName,
      phone: users.phoneE164,
      avatarUrl: memberships.avatarUrl,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(tenants.slug, "shri-gujarati-samaj"))
    .orderBy(asc(users.phoneE164));

  const base = storage.publicBaseUrl.replace(/\/$/, "");
  const next = { w: 0, m: 0 };
  let added = 0;
  for (const member of rows) {
    const woman = WOMEN.has(member.fullName.split(" ")[0] ?? "");
    const files = woman ? women : men;
    const source = files[(woman ? next.w : next.m) % files.length]!;
    if (woman) next.w++;
    else next.m++;
    if (member.avatarUrl) continue;

    const image = await processImage(await readFile(source), "image/jpeg", "avatar");
    const key = `${member.tenantId}/${portraitId(member.phone)}.jpg`;
    const file = join(storage.uploadDir, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, image.buffer);
    await db
      .insert(uploads)
      .values({
        tenantId: member.tenantId,
        userId: member.userId,
        storageKey: key,
        purpose: "avatar",
        contentType: image.mime,
        byteSize: image.buffer.length,
      })
      .onConflictDoNothing({ target: uploads.storageKey });
    await db.update(memberships).set({ avatarUrl: `${base}/uploads/${key}` }).where(and(eq(memberships.id, member.id), eq(memberships.tenantId, member.tenantId)));
    added++;
  }
  return added;
}
