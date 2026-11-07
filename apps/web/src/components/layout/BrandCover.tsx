import clsx from "clsx";
import type { ReactNode } from "react";
import type { TenantPublicDto } from "@illuminize/shared";
import { Avatar } from "@/components/ui";

/**
 * An institution's brand cover: its cover photo or its colours as a gradient, its logo, its short name as the hero, and
 * under that a line (its tagline, unless `title` says otherwise) and a smaller one. With no institution, as on the
 * platform console's sign-in, the hero is Illuminize. Full height above the landing and sign-in cards (AuthShell);
 * `compact` is a shorter band for a page that leads with its card. Either way the card after it rides up over its foot
 * (`-mt-20`), and the bottom padding keeps the hero clear of it. `wide` lines the hero up with a `max-w-2xl` card.
 */
export function BrandCover({
  tenant,
  title,
  subtitle,
  compact = false,
  wide = false,
}: {
  tenant?: TenantPublicDto | null;
  title?: ReactNode;
  subtitle?: ReactNode;
  compact?: boolean;
  wide?: boolean;
}) {
  const cover = tenant?.coverImageUrl;
  const name = tenant ? (tenant.shortName ?? tenant.name) : "Illuminize";
  const line = title === undefined && tenant ? (tenant.tagline ?? `${name} alumni network`) : title;
  return (
    <div className={clsx("relative w-full overflow-hidden bg-primary", compact ? "min-h-[22vh]" : "min-h-[42vh] sm:min-h-[48vh]")}>
      {cover ? (
        <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-secondary opacity-95" />
      )}
      {/* A fixed veil under the white text, as the cover has always had. How dark it must go for a pale brand or a bright
          photo is the contrast work's heroScrim, which belongs here rather than in each page. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-black/10" />
      <div
        className={clsx(
          "relative mx-auto flex h-full w-full flex-col justify-end px-4 pt-10",
          compact ? "min-h-[22vh] pb-24" : "min-h-[42vh] pb-28 sm:min-h-[48vh] sm:pb-32",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="flex items-end gap-3 text-white">
          {tenant ? <Avatar name={name} src={tenant.logoUrl} size="lg" className="ring-2 ring-white/40" /> : null}
          <div className="min-w-0">
            <p className="font-display text-2xl font-bold tracking-tight drop-shadow sm:text-3xl">{name}</p>
            {line && <p className="mt-1 text-sm text-white/85 drop-shadow">{line}</p>}
            {subtitle && <p className="mt-0.5 text-xs text-white/70">{subtitle}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
