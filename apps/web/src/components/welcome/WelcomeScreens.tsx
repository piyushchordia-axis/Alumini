import { WELCOME_COPY, profileStrength, sectionDescription, welcomeProfile, type MemberSection, type MembershipDto, type TenantPublicDto, type WelcomeStep } from "@illuminize/shared";
import clsx from "clsx";
import { useId, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { IconProfile, IconSearch, IconSpark } from "@/components/icons";
import { SheetTile } from "@/components/layout/SheetTile";
import { ProfileItemLinks, ProfileStrengthMeter } from "@/components/profile/ProfileStrengthCard";
import { SECTION_LINKS } from "@/lib/sections";

// In rem, so it grows with the reader's own text size.
const body = "text-[0.9375rem] leading-relaxed text-slate-700";

const STEP_ICONS: Record<WelcomeStep, ReactElement> = {
  hello: <IconSpark size={20} />,
  profile: <IconProfile size={20} />,
  explore: <IconSearch size={20} />,
};

/** The step's icon, in the ink on the wash, beside its title. */
export function StepIcon({ step }: { step: WelcomeStep }) {
  return (
    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-wash text-primary-ink">
      {STEP_ICONS[step]}
    </span>
  );
}

/** Where they are, as dots beside the "1 of 3" line, which says the same to a screen reader: the current one in the ink. */
export function StepDots({ index, count }: { index: number; count: number }) {
  return (
    <span aria-hidden className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={clsx("h-1.5 rounded-full motion-safe:transition-[width] motion-safe:duration-[var(--duration-fast)]", i === index ? "w-5 bg-primary-ink" : "w-1.5 bg-slate-300")} />
      ))}
    </span>
  );
}

/** The institution's own welcome message, as its landing page shows it (plain text, line breaks kept), then the lead. */
export function HelloScreen({ welcomeMessage }: { welcomeMessage: string | null }) {
  return (
    <div className="space-y-3">
      {welcomeMessage && <p className={clsx(body, "whitespace-pre-line break-words")}>{welcomeMessage}</p>}
      <p className={body}>{WELCOME_COPY.hello.lead}</p>
    </div>
  );
}

/**
 * How the profile stands, and the heaviest things missing as links into the parts of My profile they're added in.
 * Following one ends the walk-through (`onLeave`), which the line under them says.
 */
export function ProfileScreen({ tenant, membership, onLeave }: { tenant: TenantPublicDto; membership: MembershipDto; onLeave: () => void }) {
  const hintId = useId();
  const strength = profileStrength(membership, tenant);
  const { items, body: lead } = welcomeProfile(strength);
  return (
    <div>
      <p className={body}>{lead}</p>
      <ProfileStrengthMeter score={strength.score} className="mt-4" />
      {items.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-1">
          <ProfileItemLinks
            items={items}
            link={(item, className, children) => (
              <Link to={`/t/${tenant.slug}/app/profile#${item.section}`} className={className} aria-describedby={hintId} onClick={onLeave}>
                {children}
              </Link>
            )}
          />
        </div>
      )}
      <div className="mt-3 space-y-0.5 text-sm text-slate-500">
        {items.length > 0 && <p id={hintId}>{WELCOME_COPY.profile.linksHint(items.length)}</p>}
        <p>{WELCOME_COPY.profile.later}</p>
      </div>
    </div>
  );
}

/**
 * The sections this member can open, as More's described rows: a list, never a nav, so it's never taken for the app's
 * navigation. Following one ends the walk-through (`onLeave`) on the way there.
 */
export function ExploreScreen({ tenant, sections, onLeave }: { tenant: TenantPublicDto; sections: readonly MemberSection[]; onLeave: () => void }) {
  return (
    <div>
      <p className={body}>{WELCOME_COPY.explore.body(tenant.shortName ?? tenant.name)}</p>
      {/* role="list" because Tailwind's list-style: none drops the list from Safari's accessibility tree. The rows' icon
          wells line up with the text above them. */}
      <ul role="list" className="-mx-3 mt-4 space-y-1">
        {sections.map((section) => {
          const link = SECTION_LINKS[section];
          return <SheetTile key={section} to={`/t/${tenant.slug}/app/${link.path}`} icon={link.icon} label={link.label} description={sectionDescription(section)} onClick={onLeave} />;
        })}
      </ul>
    </div>
  );
}
