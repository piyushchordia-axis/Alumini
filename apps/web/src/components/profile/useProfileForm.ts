import {
  PROFILE_EDUCATION_YEARS_AHEAD,
  PROFILE_MIN_YEAR,
  hiddenProfileKeys,
  isCurrentPupil,
  membershipProfileSchema,
  profileSectionOf,
  validateProfileFieldValues,
  withoutHiddenProfileKeys,
  type MembershipDto,
  type MembershipProfileInput,
  type ProfileFieldDto,
  type TenantPublicDto,
} from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState, type RefObject } from "react";
import { useForm, useWatch, type Path, type Resolver } from "react-hook-form";
import type { z } from "zod";
import { answersToValues, type FieldAnswers } from "@/components/profile/CustomFieldInputs";

export type ProfileFormValues = z.input<typeof membershipProfileSchema>;

export interface ProfileFormOptions {
  tenant: TenantPublicDto;
  initial?: Partial<MembershipDto>;
  /** The institution's own questions (from api.membership.profileFields). */
  customFields?: ProfileFieldDto[];
  /** Registration asks every required question; later edits only refuse clearing one. */
  mode?: "register" | "edit";
  /** Returning the saved membership puts the form back to what was saved: lists sorted, links as stored. */
  onSubmit: (values: MembershipProfileInput) => Promise<MembershipDto | void>;
}

interface ProfileFormHookOptions extends ProfileFormOptions {
  /** The <form>, where the first error is looked for after a failed save. */
  formRef: RefObject<HTMLFormElement | null>;
}

export const toProfileFormValues = (m?: Partial<MembershipDto>): ProfileFormValues => ({
  fullName: m?.fullName ?? "",
  batchYear: m?.batchYear ?? new Date().getFullYear() - 5,
  dateOfBirth: m?.dateOfBirth ?? null,
  professionType: m?.professionType ?? "EMPLOYED",
  companyName: m?.companyName ?? null,
  designation: m?.designation ?? null,
  city: m?.city ?? null,
  country: m?.country ?? "IN",
  maritalStatus: m?.maritalStatus ?? null,
  kidsCount: m?.kidsCount ?? null,
  bio: m?.bio ?? null,
  interests: m?.interests ?? [],
  headline: m?.headline ?? null,
  industry: m?.industry ?? null,
  careerStartYear: m?.careerStartYear ?? null,
  skills: m?.skills ?? [],
  degree: m?.degree ?? null,
  fieldOfStudy: m?.fieldOfStudy ?? null,
  experiences: m?.experiences ?? [],
  education: m?.education ?? [],
  linkedinUrl: m?.linkedinUrl ?? null,
  websiteUrl: m?.websiteUrl ?? null,
  githubUrl: m?.githubUrl ?? null,
  instagramUrl: m?.instagramUrl ?? null,
  xUrl: m?.xUrl ?? null,
  openTo: m?.openTo ?? [],
  avatarUrl: m?.avatarUrl ?? null,
  isPhoneVisible: m?.isPhoneVisible ?? false,
  celebrateBirthday: m?.celebrateBirthday ?? true,
  celebrateAnniversary: m?.celebrateAnniversary ?? true,
});

/** The form's own fields, so a server error on anything else (which no input would show) is shown in full instead. */
const FORM_FIELDS = new Set(Object.keys(toProfileFormValues()));

const schemaResolver = zodResolver(membershipProfileSchema);

/**
 * The schema's check, on what the form shows this member: an input it hides (the year a student started working, a
 * current pupil's links and Open to, degree and field here at a school) keeps its value for when it shows again, but is
 * neither checked nor sent, so a value the member can't see or fix never blocks a save.
 */
const visibleResolver =
  (tenant: TenantPublicDto): Resolver<ProfileFormValues, unknown, MembershipProfileInput> =>
  (values, context, options) => {
    const hidden = hiddenProfileKeys(tenant, { professionType: values.professionType, batchYear: Number(values.batchYear), dateOfBirth: values.dateOfBirth ?? null });
    return schemaResolver(withoutHiddenProfileKeys(values, hidden), context, options);
  };

/** A year select's value: blank is null. */
export const yearValue = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));

const yearsDown = (from: number) => Array.from({ length: from - PROFILE_MIN_YEAR + 1 }, (_, i) => from - i);
/** Years a past role or the start of studies can have: this year back to PROFILE_MIN_YEAR, newest first. */
export const pastYears = () => yearsDown(new Date().getFullYear());
/** Years studies elsewhere can end in, which may be a few years ahead. */
export const studyEndYears = () => yearsDown(new Date().getFullYear() + PROFILE_EDUCATION_YEARS_AHEAD);

/** An error's message, or for a list, the first of its items' (a skill too long, a past role's end year). */
export function errorMessageOf(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { message?: unknown; root?: { message?: unknown } };
  if (typeof e.message === "string" && e.message) return e.message;
  if (typeof e.root?.message === "string") return e.root.message;
  if (Array.isArray(err)) for (const item of err) if (item && typeof item.message === "string") return item.message;
  return undefined;
}

/**
 * The profile form's state, shared by its three sections (Basics, Work, About you) whichever way they're laid out: one
 * react-hook-form instance, so a value stays when its input unmounts (a collapsed list row, a hidden section). Also the
 * institution's own questions, which live outside it, and saving: one request for everything, with each error the
 * server sends put on the input it belongs to ("experiences.1.endYear" included) and the first error brought into view.
 */
export function useProfileForm({ tenant, initial, customFields = [], mode = "edit", onSubmit, formRef }: ProfileFormHookOptions) {
  const [serverError, setServerError] = useState<unknown>(null);
  // While the photo uploads, saving would send the old one and the new one would be lost.
  const [photoBusy, setPhotoBusy] = useState(false);
  const [answers, setAnswers] = useState<FieldAnswers>(() => answersToValues(initial?.fields));
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  // Whether an answer to the institution's own questions changed since the form started or last saved.
  const [answersChanged, setAnswersChanged] = useState(false);
  // Bumped when a save resets the form, so the list editors start again, collapsed, from what was saved.
  const [version, setVersion] = useState(0);
  // Registration keeps About you behind "More about you (optional)"; both disclosures open when an error is inside.
  const [moreOpen, setMoreOpen] = useState(() => mode === "register" && (!!initial?.bio || !!initial?.linkedinUrl));
  const [personalOpen, setPersonalOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);

  const form = useForm<ProfileFormValues, unknown, MembershipProfileInput>({
    resolver: visibleResolver(tenant),
    defaultValues: toProfileFormValues(initial),
    // The first error is focused below instead, in page order, once collapsed rows and disclosures holding one have opened.
    shouldFocusError: false,
  });
  const [batchYear, dateOfBirth, professionType, fullName] = useWatch({ control: form.control, name: ["batchYear", "dateOfBirth", "professionType", "fullName"] });
  // From what's on the form, so changing the batch or date of birth shows or hides what a pupil can't have at once.
  const pupil = isCurrentPupil(tenant, { batchYear: Number(batchYear), dateOfBirth: dateOfBirth ?? null });

  const readOnly = (f: { memberEditable: boolean }) => !f.memberEditable;
  const required = customFields.filter((f) => f.required && !readOnly(f));
  const optional = customFields.filter((f) => !f.required || readOnly(f));
  const setAnswer = (key: string, value: FieldAnswers[string]) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setAnswerErrors((e) => ({ ...e, [key]: "" }));
    setAnswersChanged(true);
  };
  // Something typed here that isn't saved yet, which leaving the page would lose.
  const dirty = form.formState.isDirty || answersChanged;

  useEffect(() => {
    if (!focusRequest) return;
    const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]');
    if (!target) return;
    // An error message stands for the control its label wraps, when there is one.
    const control = target.getAttribute("aria-invalid") === "true" ? target : (target.closest("label")?.control ?? null);
    control?.focus({ preventScroll: true });
    // Centred, so neither the sticky header nor the save bar covers it.
    target.scrollIntoView({ block: "center" });
  }, [focusRequest, formRef]);

  const showErrorsAt = (paths: string[]) => {
    if (paths.some((p) => p === "maritalStatus" || p === "kidsCount")) setPersonalOpen(true);
    if (mode === "register" && paths.some((p) => profileSectionOf(p, customFields) === "about")) setMoreOpen(true);
    setFocusRequest((n) => n + 1);
  };

  const submit = form.handleSubmit(
    async (values) => {
      if (photoBusy) return;
      setServerError(null);
      // Only send answers the member can change; check them here first for instant feedback.
      const editable = Object.fromEntries(customFields.filter((f) => !readOnly(f)).map((f) => [f.key, answers[f.key] ?? null]));
      const check = validateProfileFieldValues(customFields, editable, { requireAll: mode === "register", previous: answersToValues(initial?.fields), canEdit: (f) => !readOnly(f) });
      if (Object.keys(check.errors).length) {
        setAnswerErrors(check.errors);
        showErrorsAt(Object.keys(check.errors).map((k) => `fields.${k}`));
        return;
      }
      // The photo goes only when it changed here: a form opened before the photo changed elsewhere would otherwise put
      // back one that may be gone by now (and be refused).
      const { avatarUrl, ...rest } = values;
      const changed = avatarUrl !== (initial?.avatarUrl ?? null) ? { ...rest, avatarUrl } : rest;
      try {
        const saved = await onSubmit(customFields.length ? { ...changed, fields: editable } : changed);
        if (saved) {
          form.reset(toProfileFormValues(saved));
          setAnswers(answersToValues(saved.fields));
          setAnswersChanged(false);
          setVersion((v) => v + 1);
        }
      } catch (err) {
        if (!isApiClientError(err)) return setServerError(err);
        const fields = err.fieldErrors;
        const fromServer: Record<string, string> = {};
        let placed = 0;
        for (const [path, message] of Object.entries(fields)) {
          if (path.startsWith("fields.")) fromServer[path.slice("fields.".length)] = message;
          else if (FORM_FIELDS.has(path.split(".")[0] ?? "")) form.setError(path as Path<ProfileFormValues>, { type: "server", message });
          else continue;
          placed++;
        }
        setAnswerErrors(fromServer);
        if (placed === 0 || placed < Object.keys(fields).length) setServerError(err);
        showErrorsAt(Object.keys(fields));
      }
    },
    (errors) => showErrorsAt(Object.keys(errors)),
  );

  return {
    form,
    tenant,
    initial,
    mode,
    required,
    optional,
    readOnly,
    answers,
    answerErrors,
    setAnswer,
    serverError,
    photoBusy,
    setPhotoBusy,
    dirty,
    pupil,
    professionType,
    fullName,
    version,
    moreOpen,
    setMoreOpen,
    personalOpen,
    setPersonalOpen,
    submit,
  };
}

export type ProfileFormController = ReturnType<typeof useProfileForm>;
