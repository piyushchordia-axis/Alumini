import { PROFILE_NUDGE_SNOOZE_DAYS, missingProfileItems, profileStrength, showProfileNudge, type ProfileStrength, type ProfileStrengthItem } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconChevronDown, IconProfile } from "@/components/icons";
import { Button, Card } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

/** The profile's score as a bar, read out as "Profile strength, 55% complete". */
export function ProfileStrengthMeter({ score, className }: { score: number; className?: string }) {
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <div
        role="meter"
        aria-label="Profile strength"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-valuetext={`${score}% complete`}
        className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-200/80"
      >
        <span className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${score}%` }} />
      </div>
      <span aria-hidden className="w-10 text-right text-sm font-semibold tabular-nums text-slate-900">
        {score}%
      </span>
    </div>
  );
}

/** Missing items as rows that open the part of the profile where each is added. */
function ItemLinks({ items, link }: { items: ProfileStrengthItem[]; link: (item: ProfileStrengthItem, className: string, children: ReactNode) => ReactNode }) {
  const row = "group flex min-h-11 items-center gap-3 py-2 text-sm font-medium text-slate-800 transition hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md";
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <li key={item.key}>
          {link(
            item,
            row,
            <>
              <span className="min-w-0 flex-1">{item.label}</span>
              <IconChevronDown size={16} className="-rotate-90 text-slate-400 group-hover:text-primary" />
            </>,
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The feed's nudge to fill in the profile: the score and the heaviest few items missing, each linking to where it's
 * added. Gone at PROFILE_STRENGTH_HIDE_AT, and for PROFILE_NUDGE_SNOOZE_DAYS after "Not now" on any device. A <section>
 * with no text box: the feed's posts are the page's <article>s, and its first text box is the composer.
 */
export function ProfileStrengthCard() {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const headingId = useId();
  const noteRef = useRef<HTMLParagraphElement>(null);
  // Hidden as soon as "Not now" is pressed, and back if the server refuses.
  const [hidden, setHidden] = useState(false);
  // In the card's place once it's put away, saying where it went, and holding focus so the page keeps its place.
  const [note, setNote] = useState(false);
  const dismiss = useMutation({
    mutationFn: () => api.membership.dismissProfileNudge(tenant.slug),
    onSuccess: (m) => qc.setQueryData(qk.membership(tenant.slug), m),
    onError: (err) => {
      setHidden(false);
      setNote(false);
      toast.error(errorMessage(err));
    },
  });
  const strength = profileStrength(membership, tenant);
  if (hidden || !showProfileNudge(strength.score, membership.profileNudgeDismissedAt))
    return note ? (
      // Goes once focus moves on, as a toast would.
      <p ref={noteRef} tabIndex={-1} onBlur={() => setNote(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 focus:outline-none">
        Hidden for {PROFILE_NUDGE_SNOOZE_DAYS} days. My profile always shows what's left to add.
      </p>
    ) : null;
  const profile = `/t/${tenant.slug}/app/profile`;
  return (
    <section aria-labelledby={headingId}>
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <IconProfile size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="font-display text-base font-semibold text-slate-900">
              Complete your profile
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">A fuller profile helps batchmates find you and know what you do.</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-2 -mt-1 min-h-11 shrink-0"
            onClick={() => {
              setHidden(true);
              setNote(true);
              dismiss.mutate();
              // The button goes with the card: focus moves to the note in its place rather than to the top of the page.
              requestAnimationFrame(() => noteRef.current?.focus());
            }}
          >
            Not now
          </Button>
        </div>
        <ProfileStrengthMeter score={strength.score} className="mt-4" />
        <div className="mt-3 border-t border-slate-100 pt-1">
          <ItemLinks
            items={missingProfileItems(strength)}
            link={(item, className, children) => (
              <Link to={`${profile}#${item.section}`} className={className}>
                {children}
              </Link>
            )}
          />
        </div>
      </Card>
    </section>
  );
}

/** My profile's meter, always shown: the score and everything still missing, each linking to its section below. */
export function ProfileStrengthPanel({ strength }: { strength: ProfileStrength }) {
  const headingId = useId();
  const missing = strength.items.filter((i) => !i.done);
  return (
    <section aria-labelledby={headingId}>
      <Card className="p-5">
        <h2 id={headingId} className="font-semibold text-slate-900">
          Profile strength
        </h2>
        <ProfileStrengthMeter score={strength.score} className="mt-3" />
        {missing.length > 0 ? (
          <>
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">Still to add</p>
            <div className="mt-1">
              <ItemLinks
                items={missing}
                link={(item, className, children) => (
                  <a href={`#${item.section}`} className={className}>
                    {children}
                  </a>
                )}
              />
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-slate-600">Your profile is complete. Members see everything they need to know you.</p>
        )}
      </Card>
    </section>
  );
}
