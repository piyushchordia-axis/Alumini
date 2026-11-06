import { z } from "zod";
import { tenantBrandingUpdateSchema, type TenantBrandingUpdate } from "../schemas/tenant";
import type { TenantPublicDto } from "../types/dto";
import { contrastRatio, mixHex, onColor } from "./color";
import { COMMON_TIME_ZONES, localTimeZone, zoneOffsetLabel } from "./time";

/**
 * The console's Branding form, the same on both apps: what it holds, the colours it suggests and warns about, and the
 * save it sends. Written by hand, with no Intl, so the phone app (Hermes) runs the same code.
 */

/** Every part of the institution's look, as the Branding form edits it. Optional texts are null when left empty. */
export interface BrandingDraft {
  name: string;
  shortName: string | null;
  tagline: string | null;
  welcomeMessage: string | null;
  websiteUrl: string | null;
  city: string | null;
  country: string | null;
  timezone: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
}

export function brandingDraft(t: TenantPublicDto): BrandingDraft {
  return {
    name: t.name,
    shortName: t.shortName,
    tagline: t.tagline,
    welcomeMessage: t.welcomeMessage,
    websiteUrl: t.websiteUrl,
    city: t.city,
    country: t.country,
    timezone: t.timezone,
    primaryColor: t.primaryColor,
    secondaryColor: t.secondaryColor,
    logoUrl: t.logoUrl,
    coverImageUrl: t.coverImageUrl,
  };
}

/** An optional field as typed: null once it holds nothing but spaces, so that saving clears it. */
export function blankToNull(text: string): string | null {
  return text.trim() ? text : null;
}

/** Whether `text` is a colour as `hexColorSchema` takes it: "#" and six hex digits, in any case. */
export function isHexColour(text: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(text.trim());
}

/**
 * A hex colour box's text as the form keeps it: lower case, with no spaces, and with one "#" in front ("1D4ED8" gives
 * "#1d4ed8"). Anything else typed stays, so the box can say what's wrong with it; an empty box stays empty.
 */
export function normalizeHexInput(raw: string): string {
  const digits = raw.replace(/\s+/g, "").replace(/^#+/, "").toLowerCase();
  return digits ? `#${digits}` : "";
}

export interface BrandSwatch {
  name: string;
  hex: string;
}

/**
 * Colours the form suggests, the seeded institutions' among them. Each takes white text at 4.5:1 or better and is light
 * enough to tell from the text colour, so none draws a warning (brandContrastWarnings).
 */
export const BRAND_SWATCHES: readonly BrandSwatch[] = [
  { name: "Blue", hex: "#1d4ed8" },
  { name: "Navy", hex: "#1e3a8a" },
  { name: "Sky", hex: "#0369a1" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Green", hex: "#047857" },
  { name: "Amber", hex: "#b45309" },
  { name: "Orange", hex: "#c2410c" },
  { name: "Red", hex: "#b91c1c" },
  { name: "Maroon", hex: "#7f1d1d" },
  { name: "Slate", hex: "#334155" },
];

/** A suggested colour's accessible name, such as "Teal, #0f766e". */
export function swatchLabel(swatch: BrandSwatch): string {
  return `${swatch.name}, ${swatch.hex}`;
}

/** Whether the colour in a box is `swatch`, however it's written. */
export function isSwatchChosen(swatch: BrandSwatch, value: string): boolean {
  return normalizeHexInput(value) === swatch.hex;
}

const DEFAULT_PRIMARY = "#1d4ed8";
const DEFAULT_SECONDARY = "#0f172a";
const WHITE = "#ffffff";
/** The apps' text colour. A brand this close to it looks black in a small icon or a chosen state. */
const TEXT = "#0f172a";
const LOOKS_BLACK_BELOW = 1.4;

export interface BrandPreviewColours {
  /** The gradient's start, the primary colour. */
  from: string;
  /** Its end, the secondary colour. */
  to: string;
  /** The preview's text: white, or dark on a light gradient (onColor of its middle). */
  text: string;
}

/**
 * The preview's colours for a draft. A colour still being typed ("#1d4") shows as the saved one, so the preview never
 * draws a colour that isn't one.
 */
export function brandPreviewColours(draft: Pick<BrandingDraft, "primaryColor" | "secondaryColor">, saved: Pick<BrandingDraft, "primaryColor" | "secondaryColor">): BrandPreviewColours {
  const pick = (typed: string, stored: string, fallback: string) => (isHexColour(typed) ? typed : isHexColour(stored) ? stored : fallback).trim().toLowerCase();
  const from = pick(draft.primaryColor, saved.primaryColor, DEFAULT_PRIMARY);
  const to = pick(draft.secondaryColor, saved.secondaryColor, DEFAULT_SECONDARY);
  return { from, to, text: onColor(mixHex(from, to, 0.5)) };
}

export interface BrandPreviewText {
  /** The name, or "Your institution" while the box is empty. */
  title: string;
  /** Whose initials stand in for the logo: the short name, or the title. */
  initialsOf: string;
  /** The tagline, or null while there's none. */
  tagline: string | null;
}

/** What the preview says of a draft, trimmed, the same on both apps. */
export function brandPreviewText(draft: Pick<BrandingDraft, "name" | "shortName" | "tagline">): BrandPreviewText {
  const title = draft.name.trim() || "Your institution";
  return { title, initialsOf: draft.shortName?.trim() || title, tagline: draft.tagline?.trim() || null };
}

/** A contrast ratio as "3.2:1", rounded down, so a colour just short of 4.5:1 never reads as reaching it. */
export function contrastText(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

/**
 * What the chosen colours will do to the apps that the admin may not expect, by field. Warnings only: nothing here stops
 * a save, so an institution already using such a colour keeps it. The primary colour fills buttons and colours links,
 * icons and chosen states (brandTones): one too light for white text gets dark text and a darker shade for links, and
 * one nearly black stops reading as a colour. The secondary colour only ends a gradient under a dark veil, so it has none.
 */
export function brandContrastWarnings(draft: Pick<BrandingDraft, "primaryColor" | "secondaryColor">): Partial<Record<"primaryColor" | "secondaryColor", string>> {
  const warnings: Partial<Record<"primaryColor" | "secondaryColor", string>> = {};
  if (!isHexColour(draft.primaryColor)) return warnings;
  const primary = draft.primaryColor.trim().toLowerCase();
  if (onColor(primary) !== WHITE) {
    warnings.primaryColor = `White text is hard to read on this colour (${contrastText(contrastRatio(WHITE, primary))}), so buttons filled with it use dark text, and links a darker shade of it.`;
  } else if (contrastRatio(primary, TEXT) < LOOKS_BLACK_BELOW) {
    warnings.primaryColor = "This colour is so dark that small icons and chosen states in it look black.";
  }
  return warnings;
}

/** The form's fields by name, for saying which one a problem is about. */
export const BRANDING_FIELD_LABELS: Readonly<Record<keyof BrandingDraft, string>> = {
  name: "Name",
  shortName: "Short name",
  tagline: "Tagline",
  welcomeMessage: "Welcome message",
  websiteUrl: "Website",
  city: "City",
  country: "Country",
  timezone: "Time zone",
  primaryColor: "Primary colour",
  secondaryColor: "Secondary colour",
  logoUrl: "Logo",
  coverImageUrl: "Cover image",
};

/** Words a person reads, in place of the schema's, where its own are written for developers. */
const PROBLEMS: Partial<Record<keyof BrandingDraft, string>> = {
  name: "Enter a name of 2 to 120 characters",
  shortName: "Keep the short name to 40 characters",
  tagline: "Keep the tagline to 160 characters",
  welcomeMessage: "Keep the welcome message to 2000 characters",
  websiteUrl: "Enter the whole address, starting with https://",
  city: "Keep the city to 80 characters",
};

/**
 * The schema with the time zone checked for its length alone. For the zone the institution was saved with: the server
 * took it, and a phone or browser whose own zone data is older than the server's (an Android that no longer updates)
 * may not know it, which would otherwise keep every Branding save from sending. The server still checks it.
 */
const savedZoneSchema = tenantBrandingUpdateSchema.extend({ timezone: z.string().trim().min(1).max(64).optional() });

/**
 * The save a Branding form sends, checked with the API's own schema first, or the problems that keep it from sending,
 * by field. The whole draft goes, trimmed and with empty texts as null, as the API stores it. `saved` is what the form
 * started from: its time zone, left as it was, is the server's to check (savedZoneSchema). A colour that draws a warning
 * (brandContrastWarnings) is never a problem here.
 */
export function brandingSave(draft: BrandingDraft, saved: Pick<BrandingDraft, "timezone">): { input: TenantBrandingUpdate; errors?: undefined } | { input?: undefined; errors: Record<string, string> } {
  const parsed = draft.timezone.trim() === saved.timezone.trim() ? savedZoneSchema.safeParse(draft) : tenantBrandingUpdateSchema.safeParse(draft);
  if (parsed.success) return { input: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    errors[key] ??= PROBLEMS[key as keyof BrandingDraft] ?? issue.message;
  }
  return { errors };
}

/**
 * The time zones a picker offers: `value` first, then `extra` (the zone saved before, the institution's), then the
 * device's and the common ones, each once.
 */
export function timeZoneOptions(value: string | null | undefined, extra: readonly (string | null | undefined)[] = []): string[] {
  const zones = [value, ...extra, localTimeZone(), ...COMMON_TIME_ZONES].filter((zone): zone is string => !!zone && zone.trim() !== "");
  return [...new Set(zones)];
}

/** A time zone as a picker shows it: "Asia/Kolkata (GMT+5:30)", or the name alone where the offset can't be worked out. */
export function timeZoneLabel(zone: string, at: Date = new Date()): string {
  const offset = zoneOffsetLabel(zone, at);
  const name = zone.replace(/_/g, " ");
  return offset ? `${name} (${offset})` : name;
}
