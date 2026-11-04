import { PROFILE_DEGREE_MAX_LENGTH, PROFILE_HISTORY_NAME_MAX_LENGTH, PROFILE_MAX_EDUCATION, PROFILE_MAX_EXPERIENCES, profileYearsLabel } from "@illuminize/shared";
import { useId, useRef, useState, type ReactNode } from "react";
import { useFieldArray, useWatch, type FieldError, type Path } from "react-hook-form";
import { pastYears, studyEndYears, yearValue, type ProfileFormController, type ProfileFormValues } from "@/components/profile/useProfileForm";
import { Button, FormField, Input, Select } from "@/components/ui";

/** An empty required box says what's missing rather than the schema's "Too small" (the server's never gets that far). */
const rowMessage = (err: FieldError | undefined, whenEmpty: string) => (err ? (err.type === "too_small" ? whenEmpty : err.message) : undefined);

/** An error on the list as a whole (too many entries), not on one of them. */
const listMessage = (err: unknown) => {
  const e = err as { message?: string; root?: { message?: string } } | undefined;
  return e?.root?.message ?? e?.message;
};

const yearOptions = (years: number[]) => [
  <option key="" value="">
    Year
  </option>,
  ...years.map((y) => (
    <option key={y} value={y}>
      {y}
    </option>
  )),
];

interface Row {
  id: string;
  open: boolean;
  /** What the row is, for its buttons' names: "Software engineer at Flipkart". */
  name: string;
  title: string;
  detail: string | null;
  when: string;
  editor: ReactNode;
  /** Its inputs, checked by Done. */
  fields: Path<ProfileFormValues>[];
}

/**
 * A list editor for past roles or studies. Saved entries show as a summary with Edit and Remove; a new one, one being
 * edited and one with an error show their inputs. Done checks the entry before folding it away. All of it is one
 * react-hook-form field array, saved with the rest of the profile.
 */
function HistoryList({
  form: f,
  label,
  hint,
  noun,
  addLabel,
  max,
  rows,
  onAdd,
  onRemove,
  rootError,
  maxNote,
}: {
  form: ProfileFormController;
  label: string;
  hint: string;
  noun: string;
  addLabel: string;
  max: number;
  rows: Row[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  rootError?: string;
  maxNote: string;
}) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const addButton = useRef<HTMLButtonElement>(null);
  // Entries folded into a summary, by field id: at first, every one with a name. Anything else (new, or opened again)
  // shows its inputs.
  const [folded, setFolded] = useState(() => new Set(rows.filter((r) => r.title.trim()).map((r) => r.id)));
  const setFold = (id: string, fold: boolean) =>
    setFolded((s) => {
      const next = new Set(s);
      if (fold) next.add(id);
      else next.delete(id);
      return next;
    });
  // Focus follows the entry: into its first box when it opens, onto its Edit button when it folds, to Add when it goes,
  // and to the box with the problem when Done refuses.
  const focusSoon = (find: () => HTMLElement | null | undefined) => requestAnimationFrame(() => find()?.focus());

  return (
    <div role="group" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold text-slate-900">
        {label}
      </h3>
      <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((row, i) => {
            const open = row.open || !folded.has(row.id);
            return (
              <li key={row.id} className="rounded-lg border border-slate-200 bg-white">
                {open ? (
                  <fieldset className="p-3" id={`${baseId}-${row.id}`}>
                    <legend className="sr-only">{`${noun} ${i + 1}`}</legend>
                    {row.editor}
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-11"
                        aria-label={`Remove ${noun.toLowerCase()} ${i + 1}`}
                        onClick={() => {
                          onRemove(i);
                          focusSoon(() => addButton.current ?? document.getElementById(headingId));
                        }}
                      >
                        Remove
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        aria-label={`Done with ${noun.toLowerCase()} ${i + 1}`}
                        onClick={async () => {
                          if (!(await f.form.trigger(row.fields, { shouldFocus: true }))) return;
                          setFold(row.id, true);
                          focusSoon(() => document.getElementById(`${baseId}-${row.id}-edit`));
                        }}
                      >
                        Done
                      </Button>
                    </div>
                  </fieldset>
                ) : (
                  <div className="flex items-start gap-1 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900 [overflow-wrap:anywhere]">{row.title}</p>
                      {row.detail && <p className="text-sm text-slate-600 [overflow-wrap:anywhere]">{row.detail}</p>}
                      {row.when && <p className="text-xs text-slate-500">{row.when}</p>}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      id={`${baseId}-${row.id}-edit`}
                      aria-label={`Edit ${row.name}`}
                      onClick={() => {
                        setFold(row.id, false);
                        focusSoon(() => document.getElementById(`${baseId}-${row.id}`)?.querySelector("input"));
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11"
                      aria-label={`Remove ${row.name}`}
                      onClick={() => {
                        onRemove(i);
                        focusSoon(() => addButton.current ?? document.getElementById(headingId));
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rootError && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {rootError}
        </p>
      )}
      {rows.length < max ? (
        <Button ref={addButton} type="button" variant="outline" size="sm" className="mt-3 min-h-11" onClick={onAdd}>
          {addLabel}
        </Button>
      ) : (
        <p className="mt-3 text-xs text-slate-500">{maxNote}</p>
      )}
    </div>
  );
}

/** Earlier jobs: title, company and years. The current one is the company and role above it. */
export function ExperienceListInput({ form: f }: { form: ProfileFormController }) {
  const { control, register, formState } = f.form;
  const { fields, append, remove } = useFieldArray({ control, name: "experiences" });
  const values = useWatch({ control, name: "experiences" }) ?? [];
  const errors = formState.errors.experiences;
  const rows: Row[] = fields.map((field, i) => {
    const v = values[i] ?? field;
    const err = errors?.[i];
    const at = (k: "title" | "company" | "startYear" | "endYear") => `experiences.${i}.${k}` as const;
    return {
      id: field.id,
      open: !!err,
      name: v.company ? `${v.title} at ${v.company}` : v.title,
      title: v.title,
      detail: v.company || null,
      when: profileYearsLabel(v.startYear, v.endYear),
      fields: [at("title"), at("company"), at("startYear"), at("endYear")],
      editor: (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Job title" required error={rowMessage(err?.title, "Enter the job title")}>
            <Input {...register(at("title"))} maxLength={PROFILE_HISTORY_NAME_MAX_LENGTH} invalid={!!err?.title} aria-invalid={!!err?.title || undefined} />
          </FormField>
          <FormField label="Company" required error={rowMessage(err?.company, "Enter the company")}>
            <Input {...register(at("company"))} maxLength={PROFILE_HISTORY_NAME_MAX_LENGTH} invalid={!!err?.company} aria-invalid={!!err?.company || undefined} />
          </FormField>
          <FormField label="Start year" error={err?.startYear?.message}>
            <Select {...register(at("startYear"), { setValueAs: yearValue })} invalid={!!err?.startYear} aria-invalid={!!err?.startYear || undefined}>
              {yearOptions(pastYears())}
            </Select>
          </FormField>
          <FormField label="End year" error={err?.endYear?.message}>
            <Select {...register(at("endYear"), { setValueAs: yearValue })} invalid={!!err?.endYear} aria-invalid={!!err?.endYear || undefined}>
              {yearOptions(pastYears())}
            </Select>
          </FormField>
        </div>
      ),
    };
  });
  return (
    <HistoryList
      form={f}
      label="Past roles"
      hint="Jobs you've had before this one, newest first once saved."
      noun="Past role"
      addLabel="Add a past role"
      max={PROFILE_MAX_EXPERIENCES}
      maxNote={`You've added ${PROFILE_MAX_EXPERIENCES} past roles, the most a profile holds.`}
      rows={rows}
      onAdd={() => append({ title: "", company: "", startYear: null, endYear: null }, { focusName: `experiences.${fields.length}.title` })}
      onRemove={remove}
      rootError={listMessage(errors)}
    />
  );
}

/** Studies anywhere other than this institution: a master's, another college, a course. */
export function EducationListInput({ form: f }: { form: ProfileFormController }) {
  const { control, register, formState } = f.form;
  const { fields, append, remove } = useFieldArray({ control, name: "education" });
  const values = useWatch({ control, name: "education" }) ?? [];
  const errors = formState.errors.education;
  const rows: Row[] = fields.map((field, i) => {
    const v = values[i] ?? field;
    const err = errors?.[i];
    const at = (k: "institution" | "degree" | "fieldOfStudy" | "startYear" | "endYear") => `education.${i}.${k}` as const;
    const studied = [v.degree, v.fieldOfStudy].filter(Boolean).join(", ");
    return {
      id: field.id,
      open: !!err,
      name: studied ? `${studied} at ${v.institution}` : v.institution,
      title: v.institution,
      detail: studied || null,
      when: profileYearsLabel(v.startYear, v.endYear),
      fields: [at("institution"), at("degree"), at("fieldOfStudy"), at("startYear"), at("endYear")],
      editor: (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField label="Institution" required error={rowMessage(err?.institution, "Enter where you studied")}>
              <Input {...register(at("institution"))} maxLength={PROFILE_HISTORY_NAME_MAX_LENGTH} invalid={!!err?.institution} aria-invalid={!!err?.institution || undefined} />
            </FormField>
          </div>
          <FormField label="Degree" error={err?.degree?.message}>
            <Input {...register(at("degree"))} maxLength={PROFILE_DEGREE_MAX_LENGTH} placeholder="e.g. MBA" aria-invalid={!!err?.degree || undefined} />
          </FormField>
          <FormField label="Field of study" error={err?.fieldOfStudy?.message}>
            <Input {...register(at("fieldOfStudy"))} maxLength={PROFILE_DEGREE_MAX_LENGTH} aria-invalid={!!err?.fieldOfStudy || undefined} />
          </FormField>
          <FormField label="Start year" error={err?.startYear?.message}>
            <Select {...register(at("startYear"), { setValueAs: yearValue })} invalid={!!err?.startYear} aria-invalid={!!err?.startYear || undefined}>
              {yearOptions(pastYears())}
            </Select>
          </FormField>
          <FormField label="End year (or expected)" error={err?.endYear?.message}>
            <Select {...register(at("endYear"), { setValueAs: yearValue })} invalid={!!err?.endYear} aria-invalid={!!err?.endYear || undefined}>
              {yearOptions(studyEndYears())}
            </Select>
          </FormField>
        </div>
      ),
    };
  });
  return (
    <HistoryList
      form={f}
      label="Studies elsewhere"
      hint="Other universities, colleges or courses, such as a master's."
      noun="Place of study"
      addLabel="Add a place of study"
      max={PROFILE_MAX_EDUCATION}
      maxNote={`You've added ${PROFILE_MAX_EDUCATION} places of study, the most a profile holds.`}
      rows={rows}
      onAdd={() => append({ institution: "", degree: null, fieldOfStudy: null, startYear: null, endYear: null }, { focusName: `education.${fields.length}.institution` })}
      onRemove={remove}
      rootError={listMessage(errors)}
    />
  );
}
