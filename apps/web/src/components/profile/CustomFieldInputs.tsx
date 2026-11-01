import type { ProfileFieldDto, ProfileFieldValue } from "@illuminize/shared";
import { formatProfileFieldValue } from "@illuminize/shared";
import clsx from "clsx";
import { FormField, Input, Select, Textarea } from "@/components/ui";

export type FieldAnswers = Record<string, ProfileFieldValue | null>;

/**
 * Inputs for an institution's own profile questions. `readOnly` fields (admin-managed, for members) show their
 * current answer as text. Values are kept as the API expects them (choice values, yes/no booleans, "YYYY-MM-DD").
 */
export function CustomFieldInputs({
  fields,
  values,
  errors,
  onChange,
  readOnly,
}: {
  fields: ProfileFieldDto[];
  values: FieldAnswers;
  errors: Record<string, string>;
  onChange: (key: string, value: ProfileFieldValue | null) => void;
  readOnly?: (f: ProfileFieldDto) => boolean;
}) {
  return (
    <>
      {fields.map((f) => {
        const v = values[f.key] ?? null;
        const id = `field-${f.key}`;
        const hint = [f.helpText, f.visibility === "ADMINS" ? "Only you and the admins see this." : null].filter(Boolean).join(" ") || undefined;
        const wide = f.type === "LONG_TEXT" || f.type === "MULTI_SELECT";
        if (readOnly?.(f)) {
          return (
            <div key={f.key} className={clsx(wide && "sm:col-span-2")}>
              <FormField label={f.label} hint="Set by your institution's admins." group>
                <p className="py-2 text-sm text-slate-700">{formatProfileFieldValue(f, v) || "—"}</p>
              </FormField>
            </div>
          );
        }
        let control;
        switch (f.type) {
          case "TEXT":
            control = <Input id={id} value={typeof v === "string" ? v : ""} maxLength={200} invalid={!!errors[f.key]} onChange={(e) => onChange(f.key, e.target.value)} />;
            break;
          case "LONG_TEXT":
            control = <Textarea id={id} value={typeof v === "string" ? v : ""} maxLength={2000} rows={3} onChange={(e) => onChange(f.key, e.target.value)} />;
            break;
          case "NUMBER":
            control = <Input id={id} type="number" value={typeof v === "number" ? v : ""} invalid={!!errors[f.key]} onChange={(e) => onChange(f.key, e.target.value === "" ? null : Number(e.target.value))} />;
            break;
          case "DATE":
            control = <Input id={id} type="date" value={typeof v === "string" ? v : ""} invalid={!!errors[f.key]} onChange={(e) => onChange(f.key, e.target.value || null)} />;
            break;
          case "BOOLEAN":
            control = (
              <Select id={id} value={v === true ? "true" : v === false ? "false" : ""} invalid={!!errors[f.key]} onChange={(e) => onChange(f.key, e.target.value === "" ? null : e.target.value === "true")}>
                <option value="">—</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            );
            break;
          case "SELECT": {
            const current = typeof v === "string" ? v : "";
            const options = current && !f.options.some((o) => o.value === current) ? [...f.options, { value: current, label: current }] : f.options;
            control = (
              <Select id={id} value={current} invalid={!!errors[f.key]} onChange={(e) => onChange(f.key, e.target.value || null)}>
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            );
            break;
          }
          case "MULTI_SELECT": {
            const chosen = Array.isArray(v) ? v : [];
            control = (
              <div className="flex flex-wrap gap-2 py-1">
                {f.options.map((o) => {
                  const on = chosen.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onChange(f.key, on ? chosen.filter((x) => x !== o.value) : [...chosen, o.value])}
                      className={clsx("rounded-full border px-3 py-1 text-sm transition", on ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400")}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            );
            break;
          }
        }
        return (
          <div key={f.key} className={clsx(wide && "sm:col-span-2")}>
            {/* Several toggle buttons can't sit inside one <label>, so choice lists use a labelled group. */}
            <FormField label={f.label} required={f.required} hint={hint} error={errors[f.key]} group={f.type === "MULTI_SELECT"}>
              {control}
            </FormField>
          </div>
        );
      })}
    </>
  );
}

/** Answers keyed by field key, from a membership's answer list. */
export const answersToValues = (answers: Array<{ key: string; value: ProfileFieldValue | null }> | undefined): FieldAnswers =>
  Object.fromEntries((answers ?? []).map((a) => [a.key, a.value]));
