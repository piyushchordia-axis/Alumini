import { WELCOME_COPY, welcomeDue, welcomeSections, welcomeStepCount, welcomeSteps, welcomeTitle, type MembershipDto, type WelcomeStep } from "@illuminize/shared";
import { isTransientError } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { BrandCover } from "@/components/layout/BrandCover";
import { isRepeatClick } from "@/components/profile/RegistrationSteps";
import { Button, Card } from "@/components/ui";
import { ExploreScreen, HelloScreen, ProfileScreen, StepDots, StepIcon } from "@/components/welcome/WelcomeScreens";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { homePath } from "@/lib/sections";

/**
 * The first-entry walk-through, which the front door (WelcomeGate) opens for a member who is owed it: a hello with the
 * institution's welcome message, what to add to their profile, and the sections they can open. On its own page, with
 * the brand cover and none of the app's chrome, plain as the landing page is. Every way out ends it: Skip, Get started
 * and every link on it.
 */
export function WelcomePage() {
  const { tenant, membership } = useMembership();
  const qc = useQueryClient();
  const features = tenant.settings.features;
  const sections = welcomeSections(features, membership.chatEligible);
  const steps = welcomeSteps(sections);
  const navigate = useNavigate();
  const home = homePath(tenant.slug, features);
  /**
   * Whether it was owed when the page opened. Opened when it isn't (a bookmark, a reload after it, Back to it after a link
   * on it), the page moves straight on. Once it's open, only its ways out move on, each once: ending it changes the
   * membership, and a redirect on that as well would be a second navigation.
   */
  const [owed] = useState(() => welcomeDue(membership));
  const [at, setAt] = useState(0);
  const index = Math.min(at, steps.length - 1);
  const step: WelcomeStep = steps[index] ?? "hello";
  const last = index === steps.length - 1;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const countId = useId();
  const done = useMutation({
    mutationFn: () => api.membership.finishWelcome(tenant.slug),
    onSuccess: (m) => qc.setQueryData(qk.membership(tenant.slug), m),
    retry: (failures, err) => failures < 2 && isTransientError(err),
  });

  // Each step starts at the top with its title focused, so a screen reader says where they are and reads on from there.
  useEffect(() => {
    window.scrollTo(0, 0);
    titleRef.current?.focus({ preventScroll: true });
  }, [index]);

  /**
   * Ends the walk-through here first, then on the server, as every way out does. If the server never hears, nothing is
   * said: it's owed again only at the next entry through the front door, so a member offline is never held here.
   */
  const finish = () => {
    qc.setQueryData<MembershipDto>(qk.membership(tenant.slug), (m) => m && { ...m, welcomeDoneAt: m.welcomeDoneAt ?? new Date().toISOString() });
    done.mutate();
  };
  // Skip and Get started: home, in the walk-through's place, so Back from there doesn't bring it back. A link on a screen
  // ends it (finish) and moves them itself.
  const leave = () => {
    finish();
    navigate(home, { replace: true });
  };

  if (!owed) return <Navigate to={home} replace />;

  const title = step === "hello" ? welcomeTitle(membership.fullName) : step === "profile" ? WELCOME_COPY.profile.title : WELCOME_COPY.explore.title;
  return (
    <div className="min-h-full bg-[var(--surface-page)]">
      <BrandCover tenant={tenant} compact={index > 0} wide />
      <main className="relative z-10 mx-auto -mt-20 w-full max-w-2xl px-4 pb-12">
        <section aria-labelledby={titleId}>
          <Card elevation={2} className="p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <StepIcon step={step} />
              <div className="min-w-0 flex-1">
                <h1 ref={titleRef} id={titleId} tabIndex={-1} aria-describedby={countId} className="font-display text-xl font-semibold tracking-tight text-slate-900 focus:outline-none">
                  {title}
                </h1>
                <div className="mt-1 flex items-center gap-3">
                  <p id={countId} className="text-sm text-slate-500">
                    {welcomeStepCount(index, steps.length)}
                  </p>
                  <StepDots index={index} count={steps.length} />
                </div>
              </div>
            </div>
            <div className="mt-5">
              {step === "hello" ? (
                <HelloScreen welcomeMessage={tenant.welcomeMessage} />
              ) : step === "profile" ? (
                <ProfileScreen tenant={tenant} membership={membership} onLeave={finish} />
              ) : (
                <ExploreScreen tenant={tenant} sections={sections} onLeave={finish} />
              )}
            </div>
            {/* At a large text size on a narrow phone the buttons wrap, the step's own staying at the right. */}
            <div className="mt-8 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-5">
              <Button type="button" variant="ghost" className="mr-auto min-h-11" onClick={leave}>
                {WELCOME_COPY.skip}
              </Button>
              {/* Back is left out of the first step rather than disabled: there's nothing before it. */}
              {index > 0 && (
                <Button type="button" variant="outline" className="min-h-11" onClick={(e) => !isRepeatClick(e) && setAt(index - 1)}>
                  {WELCOME_COPY.back}
                </Button>
              )}
              <Button type="button" className="min-h-11" onClick={(e) => !isRepeatClick(e) && (last ? leave() : setAt(index + 1))}>
                {last ? WELCOME_COPY.done : WELCOME_COPY.next}
              </Button>
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
}
