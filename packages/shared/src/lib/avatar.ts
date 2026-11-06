/**
 * The colours of initials drawn where there's no photo. A member's come from their membership id, so one member has one
 * colour on every screen of both apps; an institution's, a business's and a group's are the brand's. Written with
 * charCodeAt and Math.imul only, so the phone app (Hermes) gives every key the same tone the web app does.
 */
import { brandTones } from "./color";

export interface AvatarTone {
  name: string;
  /** The circle (or tile) behind the initials. */
  bg: string;
  /** The initials, and the icon drawn in their place: 4.5:1 or more on `bg`. */
  fg: string;
}

/**
 * Light circles with a dark shade of the same hue (Tailwind's 200 and 800), initials at 5.4:1 or more. Not the charts'
 * SERIES, whose fixed order means something, and never the brand, which institutions, businesses and groups keep.
 */
export const AVATAR_TONES: readonly AvatarTone[] = [
  { name: "blue", bg: "#bfdbfe", fg: "#1e40af" },
  { name: "cyan", bg: "#a5f3fc", fg: "#155e75" },
  { name: "green", bg: "#bbf7d0", fg: "#166534" },
  { name: "lime", bg: "#d9f99d", fg: "#3f6212" },
  { name: "amber", bg: "#fde68a", fg: "#92400e" },
  { name: "orange", bg: "#fed7aa", fg: "#9a3412" },
  { name: "red", bg: "#fecaca", fg: "#991b1b" },
  { name: "fuchsia", bg: "#f5d0fe", fg: "#86198f" },
];

/** FNV-1a over the key's UTF-16 units, then murmur3's finaliser, so ids that differ in one digit spread over the tones. */
export function toneHash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * A member's tone, from their membership id (the `id` of MemberCardDto, ChatMemberDto and MembershipDto, a
 * CelebrationDto's `membershipId`), or a company's, from its name. Case and the spaces around the key don't count. The
 * same person has a tone per institution, as they have a membership per institution.
 */
export function avatarTone(key: string): AvatarTone {
  return AVATAR_TONES[toneHash(key.trim().toLowerCase()) % AVATAR_TONES.length]!;
}

/**
 * An institution's, a business's or a group's initials: the brand's ink on its solid 12% tint (brandTones), 4.5:1 for
 * any brand. A colour that can't be read gives the default institution colour's, as brandTones does.
 */
export function brandAvatarTone(primary: string): AvatarTone {
  const { ink, tint } = brandTones(primary);
  return { name: "brand", bg: tint, fg: ink };
}
