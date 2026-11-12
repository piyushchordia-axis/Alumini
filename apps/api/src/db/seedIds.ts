import { createHash } from "node:crypto";

/**
 * A named seed member's membership id, from the institution's slug and the phone: the same after every reset, so the
 * demo's initials keep their colours (avatarTone reads the membership id). Shaped as a version 5 UUID (sha256 rather
 * than sha1), with the RFC variant, which z.uuid() accepts. Generated members keep random ids.
 */
export function seededMembershipId(slug: string, phone: string): string {
  const h = createHash("sha256").update(`illuminize-seed:${slug}:${phone}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
