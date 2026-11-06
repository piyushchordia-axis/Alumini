import { avatarTone } from "@illuminize/shared";
import clsx from "clsx";
import { useState } from "react";
import { IconBuilding } from "@/components/icons";
import { initials } from "@/lib/format";

const SIZE = { sm: "h-11 w-11 text-sm", md: "h-14 w-14 text-base" } as const;

/**
 * A company's logo, or its initials on a tile when it has none or the image doesn't load, in a tone from the company's
 * name (avatarTone), so two companies' tiles look apart and one company's look the same on every job. Always beside the
 * company's name, so it's hidden from screen readers and adds nothing to a card's accessible name. The address is the
 * poster's, so the image is fetched without a referrer.
 */
export function CompanyLogo({ name, src, size = "md", className }: { name: string; src: string | null | undefined; size?: keyof typeof SIZE; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const letters = initials(name);
  const tone = avatarTone(name);
  return (
    <span aria-hidden className={clsx("flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white", SIZE[size], className)}>
      {src && failed !== src ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} className="h-full w-full object-contain" />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-semibold" style={{ color: tone.fg, backgroundColor: tone.bg }}>
          {letters || <IconBuilding size={20} />}
        </span>
      )}
    </span>
  );
}
