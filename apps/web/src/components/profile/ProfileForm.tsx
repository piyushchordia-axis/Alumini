import { PROFILE_SECTION_TITLES, type ProfileSection } from "@illuminize/shared";
import { useId, useRef, type ComponentType } from "react";
import { ProfileAboutSection, ProfileBasicsSection, ProfileWorkSection } from "@/components/profile/ProfileSections";
import { useProfileForm, type ProfileFormController, type ProfileFormOptions } from "@/components/profile/useProfileForm";
import { Button, Card, ErrorBox } from "@/components/ui";

export interface ProfileFormProps extends Omit<ProfileFormOptions, "mode"> {
  submitLabel: string;
}

/** Each section's body, by section. */
export const PROFILE_SECTION_BODIES: Record<ProfileSection, ComponentType<{ form: ProfileFormController }>> = {
  basics: ProfileBasicsSection,
  work: ProfileWorkSection,
  about: ProfileAboutSection,
};

/** The edit screen's sections, in order. Each card's id is its anchor (#basics, #work, #about). */
const PROFILE_SECTION_CARDS: Array<{ id: ProfileSection; description: string }> = [
  { id: "basics", description: "Your photo, name, batch and where you live." },
  { id: "work", description: "What you do now, what you did before, and your skills." },
  { id: "about", description: "Your story, studies, links and what you're open to." },
];

/**
 * Editing a member's profile: the three sections as headed cards on one page, with a save bar that stays in reach and
 * saves them all at once. Registration shows the same sections one step at a time (RegistrationSteps).
 */
export function ProfileForm({ submitLabel, ...options }: ProfileFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const f = useProfileForm({ ...options, mode: "edit", formRef });
  const photoWaitId = useId();

  return (
    <form ref={formRef} onSubmit={f.submit} className="space-y-4">
      {PROFILE_SECTION_CARDS.map(({ id, description }) => {
        const Body = PROFILE_SECTION_BODIES[id];
        return (
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
        );
      })}
      {f.serverError ? <ErrorBox error={f.serverError} /> : null}
      {/* Above the phone's tab bar, so Save is in reach from any section. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-xl border border-[var(--border-strong)] bg-white px-3 py-2 shadow-[var(--shadow-2)] md:bottom-4 md:px-4">
        <div className="min-w-0 flex-1 text-sm text-slate-500">
          {f.photoBusy ? <PhotoWait id={photoWaitId} /> : <p className="max-sm:sr-only">Saves all three sections at once.</p>}
        </div>
        <Button type="submit" loading={f.form.formState.isSubmitting} disabled={f.photoBusy} aria-describedby={f.photoBusy ? photoWaitId : undefined}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Why saving waits: the photo is still uploading. `id` is for the waiting button's aria-describedby. */
export function PhotoWait({ id, className }: { id: string; className?: string }) {
  return (
    <p className={className ?? "text-sm text-slate-500"} id={id}>
      Wait for the photo to finish uploading.
    </p>
  );
}
