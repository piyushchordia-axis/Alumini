import {
  PORTABLE_PROFILE_KEYS,
  PROFILE_SECTIONS,
  PROFILE_SECTION_TITLES,
  REGISTRATION_STEP_HINTS,
  fillFromPortableProfile,
  hiddenProfileKeys,
  portableProfileFillMessage,
  portableProfileOfferText,
  portableProfileUndoMessage,
  profileSectionFields,
  profileSectionOfStep,
  registrationStepHeading,
  undoPortableProfileFill,
  type MembershipDto,
  type MembershipProfileInput,
  type PortableProfileDto,
  type PortableProfileFill,
  type PortableProfileKey,
  type ProfileFieldDto,
  type ProfileSection,
  type ProfileStep,
  type TenantPublicDto,
} from "@illuminize/shared";
import { Stack } from "expo-router";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { AccessibilityInfo, BackHandler, Platform, Pressable, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { IconCheck, IconSwitch } from "@/components/icons";
import { ProfileAboutSection, ProfileBasicsSection, ProfileWorkSection } from "@/components/profile/ProfileSections";
import { toDraft, useProfileDraft, type DraftValues, type ProfileDraft } from "@/components/profile/useProfileDraft";
import type { SkillsInputHandle } from "@/components/SkillsInput";
import { Button, ErrorText, focusOn, headingRole, type Focusable } from "@/components/ui";
import { colors, radius, spacing, useTheme } from "@/theme";

const WORK_KEYS = profileSectionFields("work") as (keyof DraftValues)[];
/** Only the Work inputs of `values`. */
const onlyWork = (values: DraftValues): DraftValues => Object.fromEntries(Object.entries(values).filter(([k]) => (WORK_KEYS as string[]).includes(k)));
/** The Work inputs of the draft. Each change makes a new value, so they needn't be copied. */
const workOf = (d: ProfileDraft): DraftValues => Object.fromEntries(WORK_KEYS.map((k) => [k, d[k]]));

/**
 * How long a step ignores taps once it opens, so the second tap of a double tap lands on nothing: not on the button that
 * took the first one's place ("Continue" becomes "Join the network"), nor on whatever the jump to the top brought under
 * the finger. About a phone's double-tap interval.
 */
const SETTLE_MS = 350;

const stepOf = (section: ProfileSection) => (PROFILE_SECTIONS.indexOf(section) + 1) as ProfileStep;

type Portable = Partial<Pick<ProfileDraft, PortableProfileKey>>;

const portableOf = (d: ProfileDraft) => Object.fromEntries(PORTABLE_PROFILE_KEYS.map((k) => [k, d[k]])) as Portable;

/** Another profile's portable details as this form's inputs would hold them, leaving out the ones it doesn't have. */
function copyValuesOf(copy: PortableProfileDto): Portable {
  const draft = toDraft(copy);
  return Object.fromEntries(PORTABLE_PROFILE_KEYS.filter((k) => copy[k] != null).map((k) => [k, draft[k]])) as Portable;
}

/** Values as "Use details from …" compares them: list rows without the keys that only keep their place on screen. */
const comparable = (v: Portable): Portable => ({
  ...v,
  ...(v.experiences && { experiences: v.experiences.map((r) => ({ ...r, key: "" })) }),
  ...(v.education && { education: v.education.map((r) => ({ ...r, key: "" })) }),
});

export interface RegistrationStepsProps {
  tenant: TenantPublicDto;
  initial?: Partial<MembershipDto>;
  /** The institution's own questions (api.membership.profileFields). */
  customFields: ProfileFieldDto[];
  submitLabel: string;
  onSubmit: (values: MembershipProfileInput) => Promise<void>;
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
  /** The screen's scroll view: each step starts at the top. */
  scrollRef: RefObject<ScrollViewInstance | null>;
}

/**
 * Registration in three steps, each one section of the profile, as on the web app: Basics (the photo and everything
 * required), Work, and About you. Continue checks the step it leaves; Skip for now puts Work back as it was when it was
 * last accepted; the last step sends everything at once, and a problem found then opens the step holding it. Android's
 * back button goes to the step before, and iOS's swipe back is off after the first step. The draft lives only in memory,
 * above the steps, so moving between them (or a refetch behind the screen) loses nothing.
 */
export function RegistrationSteps({ tenant, initial, customFields, submitLabel, onSubmit, needsApproval, reapplying = false, notice, intro, copy, scrollRef }: RegistrationStepsProps) {
  const skillsRef = useRef<SkillsInputHandle>(null);
  const headingRef = useRef<Focusable>(null);
  const [step, setStep] = useState<ProfileStep>(1);
  // The furthest step opened so far: the step bar can go back to any of these.
  const [furthest, setFurthest] = useState<ProfileStep>(reapplying ? 3 : 1);
  // Each arrival at a step: at the top of the screen, with its heading focused unless a problem brought them there.
  const [arrival, setArrival] = useState({ count: 0, focusHeading: false });
  const [settled, setSettled] = useState(true);
  // What "Use details from …" filled in (as compared) and each input's value before, for Undo; and what Undo then kept.
  const [copied, setCopied] = useState<{ fill: PortableProfileFill<Portable>; before: DraftValues; message: string } | null>(null);
  const [undoNote, setUndoNote] = useState<string | null>(null);
  /**
   * Work as Skip for now puts it back: as the form started, then as last accepted, when Continue checked it or "Use
   * details from …" (or its Undo) filled it in. Never what was typed and left unchecked, which would be sent as it is.
   */
  const acceptedWork = useRef<DraftValues | null>(null);

  const open = (target: ProfileStep, focusHeading: boolean) => {
    setStep(target);
    setFurthest((n) => (target > n ? target : n));
    setArrival((a) => ({ count: a.count + 1, focusHeading }));
    setSettled(false);
  };

  const f = useProfileDraft({
    tenant,
    initial,
    customFields,
    mode: "register",
    onSubmit,
    skillsRef,
    // A problem found on sending (or on leaving a step) opens the step that holds it.
    onRefused: (section) => {
      if (section && stepOf(section) !== step) open(stepOf(section), false);
    },
  });

  const accepted = () => acceptedWork.current ?? workOf(f.start);
  const acceptOnArrival = useRef(false);
  const acceptWork = useEffectEvent(() => {
    if (acceptOnArrival.current) acceptedWork.current = workOf(f.draft);
    acceptOnArrival.current = false;
  });

  useEffect(() => {
    if (!arrival.count) return;
    acceptWork();
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    if (arrival.focusHeading) focusOn(headingRef.current);
  }, [arrival, scrollRef]);

  useEffect(() => {
    if (settled) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settled, arrival.count]);

  /** Moves to `target`: back at once, forward once the step being left checks out. Never while the photo uploads. */
  const goTo = (target: ProfileStep) => {
    if (target === step || f.busy || f.photoBusy) return;
    if (target > step && !f.checkSection(profileSectionOfStep(step))) return;
    // Going back keeps a skill still being typed, whose box is about to go.
    if (step === 2 && target < step) skillsRef.current?.commit();
    // Checked on the way on: what Skip for now puts back from here, taken once the check's adding of a skill still in its
    // box has landed.
    acceptOnArrival.current = step === 2 && target > step;
    f.clearServerError();
    open(target, true);
  };

  const skipWork = () => {
    if (f.busy) return;
    f.setValues(accepted());
    f.clearServerError();
    open(3, true);
  };

  const onHardwareBack = useEffectEvent(() => {
    if (step === 1) return false;
    goTo((step - 1) as ProfileStep);
    return true;
  });
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => onHardwareBack());
    return () => subscription.remove();
  }, []);

  const copyValues = useMemo(() => (copy ? copyValuesOf(copy) : null), [copy]);
  const start = comparable(portableOf(f.start));
  // Offered on a fresh registration when it would add something.
  const offerCopy = !reapplying && !!copyValues && (!!copied || fillFromPortableProfile(comparable(copyValues), start, start).filled.length > 0);

  const applyCopy = () => {
    if (!copy || !copyValues) return;
    const d = f.draft;
    const hidden = hiddenProfileKeys(tenant, { professionType: d.professionType, batchYear: Number(d.batchYear), dateOfBirth: d.dateOfBirth || null });
    const fill = fillFromPortableProfile(comparable(copyValues), comparable(portableOf(d)), start, hidden);
    const values = Object.fromEntries(fill.filled.map((k) => [k, copyValues[k]])) as DraftValues;
    f.setValues(values);
    acceptedWork.current = { ...accepted(), ...onlyWork(values) };
    setCopied({ fill, before: Object.fromEntries(fill.filled.map((k) => [k, d[k]])) as DraftValues, message: portableProfileFillMessage(copy.source.name, fill) });
    setUndoNote(null);
  };
  // Puts back only what still holds what the copy put there: anything changed since stays, and the banner says so.
  const undoCopy = () => {
    if (!copied || !copy) return;
    const undo = undoPortableProfileFill(copied.fill, comparable(copied.before as Portable), comparable(portableOf(f.draft)));
    // What to put back, as it was: with its rows' own keys.
    const values = Object.fromEntries(Object.keys(undo.values).map((k) => [k, copied.before[k as keyof DraftValues]])) as DraftValues;
    f.setValues(values);
    // As if the copy never was: what's kept is the member's own, unchecked typing, which Skip for now leaves out.
    acceptedWork.current = { ...accepted(), ...onlyWork(copied.before) };
    setCopied(null);
    setUndoNote(portableProfileUndoMessage(copy.source.name, undo));
  };

  const section = profileSectionOfStep(step);
  return (
    <View style={[styles.stack, settled ? null : styles.settling]}>
      {/* iOS's swipe back would leave the screen and everything typed: after the first step, the step bar and Back go back. */}
      <Stack.Screen options={{ gestureEnabled: step === 1 }} />
      {notice}
      <StepBar step={step} furthest={furthest} locked={f.photoBusy || f.busy} onPick={goTo} />
      <View style={{ gap: 2 }}>
        <View ref={headingRef} tabIndex={-1} accessible {...headingRole(2)}>
          <Text style={styles.heading}>{registrationStepHeading(step)}</Text>
        </View>
        <Text style={styles.hint}>{REGISTRATION_STEP_HINTS[section]}</Text>
      </View>
      {step === 1 && intro}
      {step === 1 && offerCopy && copy && <CopyBanner copy={copy} message={copied?.message ?? null} note={undoNote} onUse={applyCopy} onUndo={undoCopy} />}
      {step === 1 && <ProfileBasicsSection form={f} />}
      {step === 2 && <ProfileWorkSection form={f} skillsRef={skillsRef} />}
      {step === 3 && <ProfileAboutSection form={f} />}
      <View style={styles.actions}>
        <ErrorText error={f.serverError} />
        {f.photoBusy && <Text style={styles.note}>Wait for the photo to finish uploading.</Text>}
        <Button title={step === 3 ? submitLabel : "Continue"} onPress={() => (step === 3 ? void f.submit() : goTo((step + 1) as ProfileStep))} loading={step === 3 && f.busy} disabled={f.photoBusy} />
        {step === 2 && <Button title="Skip for now" variant="ghost" onPress={skipWork} />}
        {step === 3 && <Button title="Back" variant="outline" onPress={() => goTo(2)} disabled={f.busy} />}
        {step === 3 && needsApproval && <Text style={styles.note}>An admin at {tenant.shortName ?? tenant.name} will review your profile before you can join.</Text>}
      </View>
    </View>
  );
}

/**
 * The three steps as bars over their names. The current one is marked; any step already opened can be gone back to (or,
 * re-applying, any at all), except while the photo uploads or the profile is being sent.
 */
function StepBar({ step, furthest, locked, onPick }: { step: ProfileStep; furthest: ProfileStep; locked: boolean; onPick: (step: ProfileStep) => void }) {
  const theme = useTheme();
  return (
    <View role="list" aria-label="Registration steps" style={styles.steps}>
      {PROFILE_SECTIONS.map((section, i) => {
        const n = (i + 1) as ProfileStep;
        const current = n === step;
        const name = `Step ${n}: ${PROFILE_SECTION_TITLES[section]}`;
        // Drawn as a bar over "1 Basics"; heard as "Step 1: Basics".
        const body = (
          <View aria-hidden style={{ gap: 6 }}>
            <View style={[styles.stepBar, { backgroundColor: n <= step ? theme.primary : n <= furthest ? theme.primarySoft : colors.border }]} />
            <Text numberOfLines={1} style={[styles.stepLabel, current ? styles.stepLabelCurrent : null]}>
              {n} {PROFILE_SECTION_TITLES[section]}
            </Text>
          </View>
        );
        return (
          <View key={section} role="listitem" style={{ flex: 1 }}>
            {!current && n <= furthest ? (
              <Pressable onPress={() => onPick(n)} disabled={locked} accessibilityRole="button" accessibilityLabel={name} aria-disabled={locked} style={styles.step}>
                {body}
              </Pressable>
            ) : (
              // aria-current reaches the web build only; React Native's types omit it.
              <View accessible accessibilityLabel={name} {...(current ? ({ "aria-current": "step" } as object) : {})} style={styles.step}>
                {body}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

interface CopyBannerProps {
  copy: PortableProfileDto;
  /** What it filled in and kept, once used. */
  message: string | null;
  /** What Undo left, having been changed since. */
  note: string | null;
  onUse: () => void;
  onUndo: () => void;
}

/**
 * "Use details from …": fills this profile from their profile at another institution, keeping anything they've typed,
 * and says what it filled and kept, with Undo, which also keeps anything they've changed since. Focus moves to Undo once
 * it has filled the form, and back after Undo: only after a press here, not each time the first step opens again.
 */
function CopyBanner({ copy, message, note, onUse, onUndo }: CopyBannerProps) {
  const theme = useTheme();
  const source = copy.source.name;
  const useButton = useRef<Focusable>(null);
  const undoButton = useRef<Focusable>(null);
  // Set by a press, and used once its result has drawn.
  const pressed = useRef<"use" | "undo" | null>(null);
  useEffect(() => {
    const was = pressed.current;
    pressed.current = null;
    if (was === "use" && message) {
      focusOn(undoButton.current);
      if (Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(message);
    } else if (was === "undo" && !message) {
      focusOn(useButton.current);
      if (note && Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(note);
    }
  }, [message, note]);
  const said = message ?? note ?? "";
  return (
    <View>
      {message ? (
        <View style={[styles.banner, styles.bannerDone]}>
          <IconCheck size={20} color="#047857" />
          <Text style={[styles.bannerText, { flex: 1, color: "#064e3b" }]}>{message}</Text>
          <Button
            ref={undoButton}
            title="Undo"
            variant="ghost"
            onPress={() => {
              pressed.current = "undo";
              onUndo();
            }}
            style={styles.undo}
          />
        </View>
      ) : (
        <View style={[styles.banner, { borderColor: theme.primarySoft, backgroundColor: theme.primarySoft }]}>
          <IconSwitch size={20} color={theme.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.bannerTitle}>You have a profile at {source}</Text>
            <Text style={styles.bannerText}>{portableProfileOfferText(copy)}</Text>
            {note && <Text style={[styles.bannerText, styles.undoNote]}>{note}</Text>}
            <Button
              ref={useButton}
              title={`Use details from ${source}`}
              variant="outline"
              onPress={() => {
                pressed.current = "use";
                onUse();
              }}
              style={styles.use}
            />
          </View>
        </View>
      )}
      {/* The web build's live region; a phone's screen reader is told directly. */}
      {Platform.OS === "web" && (
        <Text aria-live="polite" style={styles.srOnly}>
          {said}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  steps: { flexDirection: "row", gap: spacing.sm },
  step: { minHeight: 44, justifyContent: "flex-end", paddingBottom: 4 },
  stepBar: { height: 6, borderRadius: radius.full },
  stepLabel: { fontSize: 12, fontWeight: "500", color: colors.muted },
  stepLabelCurrent: { fontWeight: "700", color: colors.text },
  heading: { fontSize: 18, fontWeight: "700", color: colors.text },
  hint: { fontSize: 13, lineHeight: 18, color: colors.muted },
  actions: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.lg },
  note: { fontSize: 13, color: colors.muted, textAlign: "center" },
  settling: { pointerEvents: "none" },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  bannerDone: { borderColor: "#a7f3d0", backgroundColor: "#ecfdf5" },
  bannerTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  bannerText: { fontSize: 14, lineHeight: 20, color: "#475569" },
  // Grows to two lines for a long institution name rather than cutting it off.
  use: { alignSelf: "flex-start", height: "auto", minHeight: 44, paddingVertical: spacing.sm, marginTop: spacing.sm, backgroundColor: "#ffffff" },
  undo: { height: 44, paddingHorizontal: spacing.md, marginTop: -spacing.sm, marginRight: -spacing.sm },
  undoNote: { marginTop: spacing.xs, color: colors.text },
  // Read by screen readers, not seen.
  srOnly: { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" },
});
