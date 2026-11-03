import {
  CHAT_GROUP_DESCRIPTION_MAX_LENGTH,
  CHAT_GROUP_NAME_MAX_LENGTH,
  CHAT_GROUP_VISIBILITIES,
  CHAT_GROUP_VISIBILITY_INFO,
  chatGroupCreateSchema,
  type ChatGroupVisibility,
} from "@illuminize/shared";
import { isApiClientError } from "@illuminize/shared/client";
import { zodResolver } from "@hookform/resolvers/zod";
import clsx from "clsx";
import { useId, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Button, ErrorBox, FormField, Input, Textarea } from "@/components/ui";

type Values = z.input<typeof chatGroupCreateSchema>;
type Output = z.output<typeof chatGroupCreateSchema>;

/**
 * A group's name and description, and on a new group who can join it. Who can join is fixed once the group exists, because
 * opening an invite-only group would show its history to anyone, so editing shows it without a way to change it.
 */
export function GroupForm({
  initial,
  visibility,
  available,
  unavailableNote,
  notice,
  submitLabel,
  onSubmit,
}: {
  initial?: { name: string; description: string | null };
  /** The group's own, when editing. Leave it out for a new group, which asks. */
  visibility?: ChatGroupVisibility;
  /** Which choices this institution allows, for a new group. */
  available: readonly ChatGroupVisibility[];
  /** Why a choice that isn't available isn't. */
  unavailableNote?: string;
  /** Said above the button, such as that an admin reviews it first. */
  notice?: ReactNode;
  submitLabel: string;
  onSubmit: (v: Output) => Promise<void>;
}) {
  const [serverError, setServerError] = useState<unknown>(null);
  const choiceId = useId();
  const editing = visibility !== undefined;
  const { register, control, handleSubmit, formState, setError } = useForm<Values, unknown, Output>({
    resolver: zodResolver(chatGroupCreateSchema),
    defaultValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      // Nothing chosen to start with on a new group: it can't be changed later, so it's a decision, not a default.
      visibility: visibility ?? ("" as ChatGroupVisibility),
    },
  });
  const e = formState.errors;
  const description = useWatch({ control, name: "description" }) ?? "";

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setServerError(null);
        try {
          await onSubmit(v);
        } catch (err) {
          if (isApiClientError(err) && Object.keys(err.fieldErrors).length) {
            for (const [path, message] of Object.entries(err.fieldErrors)) setError(path as keyof Values, { message });
          } else setServerError(err);
        }
      })}
    >
      <FormField label="Group name" required error={e.name?.message}>
        <Input {...register("name")} invalid={!!e.name} maxLength={CHAT_GROUP_NAME_MAX_LENGTH} autoComplete="off" />
      </FormField>
      <FormField
        label="Description"
        error={e.description?.message}
        hint={
          <span className="flex justify-between gap-2">
            <span>What the group is for. Optional.</span>
            <span className="shrink-0 tabular-nums">
              {description.length} / {CHAT_GROUP_DESCRIPTION_MAX_LENGTH}
            </span>
          </span>
        }
      >
        <Textarea {...register("description")} rows={4} invalid={!!e.description} maxLength={CHAT_GROUP_DESCRIPTION_MAX_LENGTH} />
      </FormField>

      <fieldset aria-describedby={`${choiceId}-fixed`}>
        <legend className="mb-1 block text-sm font-medium text-slate-700">
          Who can join{!editing && <span className="text-red-500"> *</span>}
        </legend>
        <p id={`${choiceId}-fixed`} className="mb-2 text-xs text-slate-500">
          {editing ? "This was chosen when the group was created, and can't be changed." : "You can't change this after the group is created."}
        </p>
        <div className="space-y-2">
          {CHAT_GROUP_VISIBILITIES.map((v) => {
            const info = CHAT_GROUP_VISIBILITY_INFO[v];
            const off = editing ? v !== visibility : !available.includes(v);
            const id = `${choiceId}-${v}`;
            return (
              // The whole card chooses, through its label stretched over it, while the radio's name stays the label alone.
              <div
                key={v}
                className={clsx(
                  "relative flex min-h-11 gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-primary/30",
                  off ? "border-slate-200 bg-slate-50" : "cursor-pointer border-slate-300 hover:border-slate-400 has-[:checked]:border-primary has-[:checked]:bg-primary/5",
                )}
              >
                <input id={id} type="radio" value={v} disabled={off} aria-describedby={`${id}-about`} className="relative z-10 mt-1 h-4 w-4 shrink-0 accent-primary" {...register("visibility")} />
                <div className="min-w-0">
                  <label htmlFor={id} className={clsx("text-sm font-medium after:absolute after:inset-0 after:rounded-lg", off ? "text-slate-500" : "cursor-pointer text-slate-900")}>
                    {info.label}
                  </label>
                  <p id={`${id}-about`} className="text-sm text-slate-600">
                    {info.description}
                    {!editing && off && unavailableNote ? ` ${unavailableNote}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        {e.visibility && (
          <p className="mt-1 text-xs text-red-600" role="alert">
            {e.visibility.message}
          </p>
        )}
      </fieldset>

      {notice && <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</div>}
      {serverError ? <ErrorBox error={serverError} /> : null}
      <Button type="submit" className="min-h-11" loading={formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
