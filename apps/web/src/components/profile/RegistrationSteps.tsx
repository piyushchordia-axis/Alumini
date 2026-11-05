import {
  PORTABLE_PROFILE_KEYS,
  PROFILE_SECTIONS,
  PROFILE_SECTION_TITLES,
  REGISTRATION_LEAVE_CONFIRM,
  REGISTRATION_NUMBER_CONFIRM,
  REGISTRATION_STEP_HINTS,
  fillFromPortableProfile,
  hiddenProfileKeys,
  portableProfileFillMessage,
  portableProfileOfferText,
  portableProfileUndoMessage,
  profileSectionFields,
  profileSectionOfStep,
  profileStepOf,
  registrationStepHeading,
  undoPortableProfileFill,
  type PortableProfileDto,
  type PortableProfileFill,
  type ProfileStep,
} from "@illuminize/shared";
import clsx from "clsx";
import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import type { Path } from "react-hook-form";
import { useBlocker } from "react-router-dom";
import { SignedInAs } from "@/components/auth/SignedInAs";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { IconCheck, IconSwitch } from "@/components/icons";
import { PROFILE_SECTION_BODIES, PhotoWait } from "@/components/profile/ProfileForm";
import { toProfileFormValues, useProfileForm, type ProfileFormOptions, type ProfileFormValues } from "@/components/profile/useProfileForm";
import { Button, ErrorBox } from "@/components/ui";

type FormKey = Path<ProfileFormValues>;
type Values = Partial<ProfileFormValues>;
const WORK_FIELDS = profileSectionFields("work") as FormKey[];
const isWorkField = (key: string) => (WORK_FIELDS as string[]).includes(key);

/** A PortableProfileDto's details as form values: they have the same shapes. */
const copyValuesOf = (copy: PortableProfileDto) => Object.fromEntries(PORTABLE_PROFILE_KEYS.map((k) => [k, copy[k]])) as Values;

/** The Work inputs of `values`, copied, as list rows are changed in place. */
const workOf = (values: Values): Values => Object.fromEntries(WORK_FIELDS.map((n) => [n, structuredClone(values[n as keyof Values])]));
/** Only the Work inputs of `values`. */
const onlyWork = (values: Values): Values => Object.fromEntries(Object.entries(values).filter(([k]) => isWorkField(k)));

/**
 * The second click of a double-click lands on whichever button has just taken the first one's place ("Continue" becomes
 * "Join the network"): it's dropped, so a double-click moves one step. Keyboard presses and single clicks pass.
 */
const isRepeatClick = (e: MouseEvent) => e.detail > 1;

/** Where the browser's history is, as the router counts it (its own `idx` in each entry's state). */
export const historyIndex = (): number | undefined => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : undefined;
};

/** Focuses the element with this id once the change that brings it in has drawn. */
const focusSoon = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

export interface RegistrationStepsProps extends Omit<ProfileFormOptions, "mode"> {
  submitLabel: string;
  /** An admin approves new members here: the last step says so under the button. */
  needsApproval: boolean;
  /** Re-applying after a rejection: every step is filled in already, so any of them can be opened. */
  reapplying?: boolean;
  /** Shown above every step: why a re-application is needed. */
  notice?: ReactNode;
  /** Shown on the first step only: an invitation. */
  intro?: ReactNode;
  /** Their profile at another institution, offered on the first step as "Use details from …". */
  copy?: PortableProfileDto | null;
  /** The number they signed in with, shown on the first step with "Use a different number", which signs out. */
  account?: { phone: string; onUseDifferentNumber: () => void | Promise<void> };
  /** Back on the first step: back where they came from. */
  onLeave: () => void;
}

type Asking = "leave" | "back" | "number";

/**
 * Registration in three steps, each one section of the profile: Basics (the photo and everything required), Work, and
 * About you. Continue checks the step it leaves; Skip for now puts Work back as it was when it was last accepted; the
 * last step sends everything at once, and an error the server finds opens the step holding it. Back, and the browser's
 * Back, go to the step before; on the first step they leave, asking first if anything has been typed. The draft lives
 * only in memory, above the steps, so moving between them (or a refetch behind the page) loses nothing.
 */
export function RegistrationSteps({ submitLabel, needsApproval, reapplying = false, notice, intro, copy, account, onLeave, ...options }: RegistrationStepsProps) {
  const customFields = options.customFields ?? [];
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<ProfileStep>(1);
  // The furthest step opened so far: the step list can go back to any of these.
  const [furthest, setFurthest] = useState<ProfileStep>(reapplying ? 3 : 1);
  const [headingFocus, setHeadingFocus] = useState(0);
  // What "Use details from …" filled in, and each input's value before, for Undo; and what Undo then kept.
  const [copied, setCopied] = useState<{ fill: PortableProfileFill<Values>; before: Values; message: string } | null>(null);
  const [undoNote, setUndoNote] = useState<string | null>(null);
  /**
   * Work as Skip for now puts it back: as the form started, then as last accepted, when Continue checked it or "Use
   * details from …" (or its Undo) filled it in. Never what was typed and left unchecked, which would be sent as it is.
   */
  const acceptedWork = useRef<Values | null>(null);
  const moving = useRef(false);
  // What the confirm dialog is asking: leave (Back on Basics), the browser's Back on Basics, or a different number.
  const [asking, setAsking] = useState<Asking | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  // Set once they've chosen to go, so the way out isn't held.
  const leaving = useRef(false);
  // Set while the browser's Back on Basics is held for the confirm dialog, which the router's answer mustn't undo.
  const holdingBack = useRef(false);
  const photoWaitId = useId();
  const copyMessageId = useId();
  const undoNoteId = useId();

  const show = (target: ProfileStep, focusHeading: boolean) => {
    setStep(target);
    setFurthest((n) => (target > n ? target : n));
    if (focusHeading) setHeadingFocus((n) => n + 1);
  };

  const f = useProfileForm({
    ...options,
    mode: "register",
    formRef,
    // The earliest step with a problem opens, and the first problem in it is focused.
    onErrors: (paths) => {
      if (paths.length) show(Math.min(...paths.map((p) => profileStepOf(p, customFields))) as ProfileStep, false);
    },
  });
  const { form } = f;
  // Work as the form started, until something is accepted (acceptedWork).
  const [workAtStart] = useState(() => workOf(form.getValues()));
  const accepted = () => acceptedWork.current ?? workAtStart;

  // A new step starts at the top, with its heading focused so a screen reader says where they are.
  useEffect(() => {
    if (!headingFocus) return;
    window.scrollTo(0, 0);
    headingRef.current?.focus({ preventScroll: true });
  }, [headingFocus]);

  // The browser's Back (a phone's back gesture) goes to the step before, as Back does, rather than leaving the page and
  // everything typed with it: the router asks this about each navigation, and a Back from a later step is answered here
  // (not while the profile is being sent) and held, the page staying where it is. On the first step it leaves, but with
  // something typed it's held while they're asked. Only a Back one page within this visit is held: the router numbers
  // each page load's history afresh, and holding a Back to a page from another load would jump by the wrong count, or
  // reload. Leaving on purpose (Back on Basics, a different number) isn't held; nor is sending, which replaces the page.
  const [entryIndex] = useState(() => historyIndex());
  const blocker = useBlocker(({ historyAction }) => {
    if (leaving.current || historyAction !== "POP" || entryIndex === undefined || historyIndex() !== entryIndex - 1) return false;
    if (step === 1) {
      if (!f.dirty) return false;
      holdingBack.current = true;
      setAsking("back");
      return true;
    }
    holdingBack.current = false;
    if (!form.formState.isSubmitting) show((step - 1) as ProfileStep, true);
    return true;
  });
  useEffect(() => {
    if (blocker.state === "blocked" && !holdingBack.current) blocker.reset();
  }, [blocker]);

  /** Back on the first step: where they came from, asking first if anything has been typed. */
  const leave = () => {
    if (f.dirty) return setAsking("leave");
    leaving.current = true;
    onLeave();
  };

  /** Signs out, for signing in with another number, asking first if anything has been typed. */
  const switchNumber = async (confirmed: boolean) => {
    if (!account) return;
    if (f.dirty && !confirmed) return setAsking("number");
    leaving.current = true;
    setSigningOut(true);
    await account.onUseDifferentNumber();
  };

  const confirmAsked = () => {
    if (asking === "number") return void switchNumber(true);
    setAsking(null);
    leaving.current = true;
    if (asking === "back") {
      holdingBack.current = false;
      blocker.proceed?.();
    } else onLeave();
  };

  const cancelAsked = () => {
    if (asking === "back") {
      holdingBack.current = false;
      blocker.reset?.();
    }
    setAsking(null);
  };

  /** Moves to `target`, checking the step being left first when moving on. Never while the photo uploads. */
  const goTo = async (target: ProfileStep) => {
    if (target < step) return show(target, true);
    if (moving.current || f.photoBusy) return;
    moving.current = true;
    try {
      if (!(await f.checkSection(profileSectionOfStep(step)))) return;
      if (step === 2) acceptedWork.current = workOf(form.getValues());
      show(target, true);
    } finally {
      moving.current = false;
    }
  };

  const skipWork = () => {
    const work = accepted();
    for (const n of WORK_FIELDS) form.setValue(n, structuredClone(work[n as keyof Values]) as never, { shouldDirty: true });
    form.clearErrors(WORK_FIELDS);
    show(3, true);
  };

  // Enter in a box presses the step's main button: Continue until the last step, which sends the profile.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (step === 3) return void f.submit(e);
    e.preventDefault();
    void goTo((step + 1) as ProfileStep);
  };

  const start = toProfileFormValues(f.initial);
  const copyValues = copy ? copyValuesOf(copy) : null;
  // Offered only when it would add something to a fresh registration.
  const offerCopy = !!copyValues && !reapplying && (copied || fillFromPortableProfile<Values>(copyValues, start, start).filled.length > 0);

  const applyCopy = () => {
    if (!copy || !copyValues) return;
    const values = form.getValues();
    const hidden = hiddenProfileKeys(f.tenant, { professionType: values.professionType, batchYear: Number(values.batchYear), dateOfBirth: values.dateOfBirth ?? null });
    const fill = fillFromPortableProfile<Values>(copyValues, values, start, hidden);
    const before = Object.fromEntries(fill.filled.map((k) => [k, structuredClone(values[k])])) as Values;
    for (const k of fill.filled) form.setValue(k, structuredClone(fill.values[k]) as never, { shouldDirty: true });
    form.clearErrors(fill.filled);
    acceptedWork.current = { ...accepted(), ...structuredClone(onlyWork(fill.values)) };
    setCopied({ fill, before, message: portableProfileFillMessage(copy.source.name, fill) });
    setUndoNote(null);
    focusSoon("undo-copy");
  };

  // Puts back only what still holds what the copy put there: anything changed since stays, and the banner says so.
  const undoCopy = () => {
    if (!copied || !copy) return;
    const undo = undoPortableProfileFill(copied.fill, copied.before, form.getValues());
    for (const [k, v] of Object.entries(undo.values)) form.setValue(k as FormKey, structuredClone(v) as never, { shouldDirty: true });
    // As if the copy never was: what's kept is the member's own, unchecked typing, which Skip for now leaves out.
    acceptedWork.current = { ...accepted(), ...structuredClone(onlyWork(copied.before)) };
    setCopied(null);
    setUndoNote(portableProfileUndoMessage(copy.source.name, undo));
    focusSoon("use-copy");
  };

  const section = profileSectionOfStep(step);
  const Body = PROFILE_SECTION_BODIES[section];
  const busy = form.formState.isSubmitting;

  const asked = asking === "number" ? REGISTRATION_NUMBER_CONFIRM : REGISTRATION_LEAVE_CONFIRM;

  return (
    <>
      <form ref={formRef} onSubmit={onSubmit} className="space-y-6">
        {notice}
        <StepList step={step} furthest={furthest} locked={f.photoBusy || busy} onPick={(n) => void goTo(n)} />
        <div>
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-lg font-semibold text-slate-900 focus:outline-none">
            {registrationStepHeading(step)}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{REGISTRATION_STEP_HINTS[section]}</p>
          {step === 1 && account && <SignedInAs phone={account.phone} onUseDifferentNumber={() => void switchNumber(false)} className="mt-1" />}
        </div>
        {step === 1 && intro}
        {step === 1 && offerCopy && copy && (
          <CopyBanner copy={copy} message={copied?.message ?? null} messageId={copyMessageId} note={undoNote} noteId={undoNoteId} onUse={applyCopy} onUndo={undoCopy} />
        )}
        <Body form={f} />
        {f.serverError ? (
          <div role="alert">
            <ErrorBox error={f.serverError} />
          </div>
        ) : null}
        <div className="space-y-3 border-t border-slate-100 pt-5">
          {f.photoBusy && <PhotoWait id={photoWaitId} className="text-center text-sm text-slate-500 sm:text-right" />}
          {/* Back first, at the left, and last on a narrow screen, where the primary button comes first. */}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            <Button type="button" variant="outline" className="min-h-11 sm:mr-auto" disabled={busy} onClick={(e) => !isRepeatClick(e) && (step === 1 ? leave() : void goTo((step - 1) as ProfileStep))}>
              Back
            </Button>
            {step === 2 && (
              <Button type="button" variant="ghost" className="min-h-11" onClick={(e) => !isRepeatClick(e) && skipWork()}>
                Skip for now
              </Button>
            )}
            <Button
              type="submit"
              className="min-h-11 sm:min-w-40"
              loading={step === 3 && busy}
              disabled={f.photoBusy}
              aria-describedby={f.photoBusy ? photoWaitId : undefined}
              onClick={(e) => isRepeatClick(e) && e.preventDefault()}
            >
              {step === 3 ? submitLabel : "Continue"}
            </Button>
          </div>
          {step === 3 && needsApproval && (
            <p className="text-center text-xs text-slate-500 sm:text-right">An admin at {f.tenant.shortName ?? f.tenant.name} will review your profile before you can join.</p>
          )}
        </div>
      </form>
      {/* Outside the form: its buttons would otherwise submit it. */}
      <ConfirmDialog
        open={asking === "back" ? blocker.state === "blocked" : asking !== null}
        title={asked.title}
        body={asked.body}
        confirmLabel={asked.confirm}
        destructive
        busy={signingOut}
        onConfirm={confirmAsked}
        onCancel={cancelAsked}
      />
    </>
  );
}

/**
 * The three steps as a bar under their names. The current one is marked; any step already opened can be gone back to
 * (or, re-applying, any at all), except while the photo uploads or the profile is being sent.
 */
function StepList({ step, furthest, locked, onPick }: { step: ProfileStep; furthest: ProfileStep; locked: boolean; onPick: (step: ProfileStep) => void }) {
  return (
    <nav aria-label="Registration steps">
      <ol className="grid grid-cols-3 gap-2">
        {PROFILE_SECTIONS.map((section, i) => {
          const n = (i + 1) as ProfileStep;
          const current = n === step;
          const name = `Step ${n}: ${PROFILE_SECTION_TITLES[section]}`;
          // Drawn as a bar over "1 Basics"; heard as "Step 1: Basics".
          const body = (
            <span aria-hidden className="block">
              <span className={clsx("block h-1.5 rounded-full", n <= step ? "bg-primary" : n <= furthest ? "bg-primary/35" : "bg-slate-200")} />
              <span className={clsx("mt-2 flex items-center gap-1.5 text-xs", current ? "font-semibold text-slate-900" : "font-medium text-slate-500")}>
                <span className="tabular-nums">{n}</span>
                <span className="truncate">{PROFILE_SECTION_TITLES[section]}</span>
              </span>
            </span>
          );
          return (
            <li key={section}>
              {!current && n <= furthest ? (
                <button
                  type="button"
                  aria-label={name}
                  disabled={locked}
                  onClick={(e) => !isRepeatClick(e) && onPick(n)}
                  className="block min-h-11 w-full rounded-md pb-1 pt-2 text-left transition hover:[&_.truncate]:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed"
                >
                  {body}
                </button>
              ) : (
                <div aria-current={current ? "step" : undefined} className="min-h-11 pb-1 pt-2">
                  <span className="sr-only">{name}</span>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface CopyBannerProps {
  copy: PortableProfileDto;
  /** What it filled in and kept, once used. */
  message: string | null;
  messageId: string;
  /** What Undo left, having been changed since. */
  note: string | null;
  noteId: string;
  onUse: () => void;
  onUndo: () => void;
}

/**
 * "Use details from …": fills this profile from their profile at another institution, leaving anything they've typed,
 * and says what it filled and kept, with Undo, which also leaves anything they've changed since.
 */
function CopyBanner({ copy, message, messageId, note, noteId, onUse, onUndo }: CopyBannerProps) {
  const source = copy.source.name;
  if (message)
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <IconCheck size={20} className="mt-0.5 text-emerald-700" />
        <p id={messageId} className="min-w-0 flex-1 text-sm text-emerald-900">
          {message}
        </p>
        <Button id="undo-copy" type="button" variant="ghost" size="sm" className="-my-1 min-h-11 shrink-0" aria-describedby={messageId} onClick={onUndo}>
          Undo
        </Button>
      </div>
    );
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <IconSwitch size={20} className="mt-0.5 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">You have a profile at {source}</p>
        <p className="mt-0.5 text-sm text-slate-600">{portableProfileOfferText(copy)}</p>
        {note && (
          <p id={noteId} className="mt-2 text-sm text-slate-700">
            {note}
          </p>
        )}
        <Button id="use-copy" type="button" variant="outline" size="sm" className="mt-3 min-h-11 bg-white" aria-describedby={note ? noteId : undefined} onClick={onUse}>
          Use details from {source}
        </Button>
      </div>
    </div>
  );
}
