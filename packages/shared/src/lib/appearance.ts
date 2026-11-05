import { MEMBER_BACKDROPS, type MemberBackdrop } from "../constants";
import type { MemberAppearanceUpdate } from "../schemas/membership";
import type { MemberAppearanceDto, TenantPublicDto } from "../types/dto";
import { brandTones, inkOn, mixHex, pageTint } from "./color";

/**
 * A member's appearance as stored on their membership. Keys may be missing, and a backdrop may be one this version doesn't
 * know, so it is read only through resolveAppearance.
 */
export interface MemberAppearance {
  backdrop?: string;
  photoUrl?: string | null;
}

export const BACKDROP_LABELS: Record<MemberBackdrop, string> = {
  PLAIN: "Plain",
  BRAND: "Institution colour",
  COVER: "Institution cover",
  PHOTO: "Your photo",
};

/** Both apps' plain page: web `--surface-page`, mobile `colors.bg`. */
export const PLAIN_PAGE_COLOR = "#f1f5f9";
/** How much of the page colour lies over a background photo: enough for grey text one shade darker to read on any photo. */
export const BACKDROP_SCRIM = 0.85;
/** Grey text on a page that isn't plain (PageBackdropSpec.dimText): slate-600, one shade darker than the usual slate-500. */
export const DIM_PAGE_TEXT = "#475569";
/** What the institution colour is mixed into for its tint, as pageTint's default. */
const TINT_BASE = "#f8fafc";
/** The share of the brand behind a current link on the page (web `bg-primary/12`, mobile `primarySoft`). */
const PAGE_LINK_WASH = 0.12;

/**
 * The complete appearance to act on: a missing or unknown backdrop is the plain one, as is "Your photo" without a photo
 * (the server never stores that, but a hand-edited row could hold it).
 */
export function resolveAppearance(stored: MemberAppearance | null | undefined): MemberAppearanceDto {
  const photoUrl = typeof stored?.photoUrl === "string" && stored.photoUrl ? stored.photoUrl : null;
  const stated = stored?.backdrop;
  const backdrop = isMemberBackdrop(stated) ? stated : "PLAIN";
  return { backdrop: backdrop === "PHOTO" && !photoUrl ? "PLAIN" : backdrop, photoUrl };
}

function isMemberBackdrop(value: unknown): value is MemberBackdrop {
  return typeof value === "string" && (MEMBER_BACKDROPS as readonly string[]).includes(value);
}

/** What a page of the signed-in app draws behind its content. */
export interface PageBackdropSpec {
  /** The page colour: the whole background without a photo, and the veil over one. */
  color: string;
  /** The photo under the veil, or null. */
  imageUrl: string | null;
  /** The veil's opacity over the photo. */
  scrim: number;
  /**
   * On a tint or over a photo, grey text on the page itself steps one shade darker (DIM_PAGE_TEXT) so it stays readable
   * there, and brand-coloured text on it takes pageInk.
   */
  dimText: boolean;
}

/**
 * What to draw for a member's appearance at an institution. Their own membership carries it; anything without one (a page
 * before the membership loads, one cached before appearances existed) gets the plain page. The institution colour gives
 * a visible tint of it (8% of the brand, pageTint), on which grey text steps one shade darker so that it reads at least
 * as well as on the plain page. The cover, or their own photo, lies under the plain page colour at BACKDROP_SCRIM, with
 * the same darker grey text; without that photo (the institution took its cover away) the page is plain, and the choice
 * comes back with the photo.
 */
export function pageBackdrop(
  appearance: MemberAppearance | null | undefined,
  institution: Pick<TenantPublicDto, "primaryColor" | "coverImageUrl"> | null | undefined,
): PageBackdropSpec {
  const plain: PageBackdropSpec = { color: PLAIN_PAGE_COLOR, imageUrl: null, scrim: BACKDROP_SCRIM, dimText: false };
  const { backdrop, photoUrl } = resolveAppearance(appearance);
  const photo = (url: string | null | undefined): PageBackdropSpec => (url ? { ...plain, imageUrl: url, dimText: true } : plain);
  switch (backdrop) {
    case "BRAND":
      // A tint light enough for slate-500 to keep its contrast is too faint to see (#f1f5fb for a blue), so the tint
      // is measured against the darker grey text the page then uses.
      return institution ? { ...plain, color: pageTint(institution.primaryColor, TINT_BASE, DIM_PAGE_TEXT), dimText: true } : plain;
    case "COVER":
      return photo(institution?.coverImageUrl);
    case "PHOTO":
      return photo(photoUrl);
    default:
      return plain;
  }
}

/**
 * The brand colour as text drawn on the page itself rather than in a card: the current section's link in the web
 * sidebar, the phone's Filters toggles. On the plain page it is the brand as those have always drawn it. On a tint or
 * over a photo, which can be darker, it is the brand's ink (brandTones) darkened until it reads at 4.5:1 on the darkest
 * the page gets (the tint, or the veil over a black photo) with the brand's soft wash on it, as a current link has.
 */
export function pageInk(primary: string, page: PageBackdropSpec): string {
  if (!page.dimText) return primary;
  const { ink } = brandTones(primary);
  const darkest = page.imageUrl ? mixHex(page.color, "#000000", page.scrim) : page.color;
  return inkOn(ink, mixHex(ink, darkest, PAGE_LINK_WASH));
}

/** The backdrops both apps offer at an institution: its cover only when it has one. */
export function backdropChoices(institution: Pick<TenantPublicDto, "coverImageUrl">): MemberBackdrop[] {
  return MEMBER_BACKDROPS.filter((b) => b !== "COVER" || !!institution.coverImageUrl);
}

/** The backdrop shown as chosen: the member's choice, or Plain while the cover they chose is gone (the page is plain then). */
export function chosenBackdrop(appearance: MemberAppearance | null | undefined, institution: Pick<TenantPublicDto, "coverImageUrl">): MemberBackdrop {
  const { backdrop } = resolveAppearance(appearance);
  return backdrop === "COVER" && !institution.coverImageUrl ? "PLAIN" : backdrop;
}

/**
 * The change that removes the member's photo. "Your photo" can't stay chosen without one, so it falls back to Plain;
 * another choice (the institution's colour, say) stays as it is.
 */
export function photoRemoval(appearance: MemberAppearance | null | undefined): MemberAppearanceUpdate {
  return resolveAppearance(appearance).backdrop === "PHOTO" ? { backdrop: "PLAIN", photoUrl: null } : { photoUrl: null };
}
