import type { ProfileSection } from "@illuminize/shared";
import { useId, useRef, type ComponentType } from "react";
import { DisclosureSummary, ProfileAboutSection, ProfileBasicsSection, ProfileWorkSection } from "@/components/profile/ProfileSections";
import { useProfileForm, type ProfileFormController, type ProfileFormOptions } from "@/components/profile/useProfileForm";
import { Button, Card, ErrorBox } from "@/components/ui";

export interface ProfileFormProps extends ProfileFormOptions {
  submitLabel: string;
}

export const PROFILE_SECTION_TITLES: Record<ProfileSection, string> = { basics: "Basics", work: "Work", about: "About you" };

/** The edit screen's sections, in order. Each card's id is its anchor (#basics, #work, #about). */
const PROFILE_SECTION_CARDS: Array<{ id: ProfileSection; description: string; Body: ComponentType<{ form: ProfileFormController }> }> = [
  { id: "basics", description: "Your photo, name, batch and where you live.", Body: ProfileBasicsSection },
  { id: "work", description: "What you do now, what you did before, and your skills.", Body: ProfileWorkSection },
  { id: "about", description: "Your story, studies, links and what you're open to.", Body: ProfileAboutSection },
];

/**
 * A member's profile. Editing shows the three sections as headed cards on one page, with a save bar that stays in reach
 * and saves them all at once. Registration keeps them on one page too, with About you behind "More about you (optional)".
 */
export function ProfileForm({ submitLabel, ...options }: ProfileFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const f = useProfileForm({ ...options, formRef });
  const photoWaitId = useId();
  const workHeadingId = useId();
  const photoWait = f.photoBusy && (
    <p className="text-center text-sm text-slate-500" id={photoWaitId}>
      Wait for the photo to finish uploading.
    </p>
  );
  const save = (block: boolean) => (
    <Button type="submit" block={block} loading={f.form.formState.isSubmitting} disabled={f.photoBusy} aria-describedby={f.photoBusy ? photoWaitId : undefined}>
      {submitLabel}
    </Button>
  );

  if (options.mode === "register")
    return (
      <form ref={formRef} onSubmit={f.submit} className="space-y-6">
        <ProfileBasicsSection form={f} />
        <section aria-labelledby={workHeadingId} className="space-y-3">
          <h2 id={workHeadingId} className="text-sm font-semibold text-slate-900">
            Work <span className="font-normal text-slate-500">(optional)</span>
          </h2>
          <ProfileWorkSection form={f} />
        </section>
        <details className="rounded-lg border border-slate-200" open={f.moreOpen} onToggle={(e) => f.setMoreOpen(e.currentTarget.open)}>
          <DisclosureSummary>More about you (optional)</DisclosureSummary>
          <div className="px-4 pb-4 pt-2">
            <ProfileAboutSection form={f} />
          </div>
        </details>
        {f.serverError ? <ErrorBox error={f.serverError} /> : null}
        {photoWait}
        {save(true)}
      </form>
    );

  return (
    <form ref={formRef} onSubmit={f.submit} className="space-y-4">
      {PROFILE_SECTION_CARDS.map(({ id, description, Body }) => (
        // Clear of the sticky header when a link jumps here.
        <section key={id} id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
          <Card className="p-5">
            <h2 id={`${id}-heading`} className="text-base font-semibold text-slate-900">
              {PROFILE_SECTION_TITLES[id]}
            </h2>
            <p className="mb-5 mt-0.5 text-sm text-slate-500">{description}</p>
            <Body form={f} />
          </Card>
        </section>
      ))}
      {f.serverError ? <ErrorBox error={f.serverError} /> : null}
      {/* Above the phone's tab bar, so Save is in reach from any section. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-xl border border-[var(--border-strong)] bg-white px-3 py-2 shadow-[var(--shadow-2)] md:bottom-4 md:px-4">
        <div className="min-w-0 flex-1 text-sm text-slate-500">{photoWait || <p className="max-sm:sr-only">Saves all three sections at once.</p>}</div>
        {save(false)}
      </div>
    </form>
  );
}
