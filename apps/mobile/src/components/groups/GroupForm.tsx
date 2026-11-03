import { CHAT_GROUP_DESCRIPTION_MAX_LENGTH, CHAT_GROUP_NAME_MAX_LENGTH, CHAT_GROUP_VISIBILITIES, CHAT_GROUP_VISIBILITY_INFO, chatGroupCreateSchema, type ChatGroupVisibility } from "@illuminize/shared";
import type { z } from "zod";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFormErrors } from "@/components/forms/useFormErrors";
import { Button, ErrorText, Input } from "@/components/ui";
import { colors, radius, spacing, useTheme } from "@/theme";

type Output = z.output<typeof chatGroupCreateSchema>;

/** One choice of who can join, as a radio: its name, and what it means for history. */
function VisibilityChoice({ value, checked, disabled, note, onPress }: { value: ChatGroupVisibility; checked: boolean; disabled: boolean; note?: string; onPress: () => void }) {
  const theme = useTheme();
  const info = CHAT_GROUP_VISIBILITY_INFO[value];
  const about = `${info.description}${note ? ` ${note}` : ""}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={info.label}
      accessibilityHint={about}
      // The ARIA forms, which React Native maps on devices and react-native-web emits.
      aria-checked={checked}
      aria-disabled={disabled}
      style={{
        flexDirection: "row",
        gap: spacing.md,
        minHeight: 44,
        borderWidth: 1,
        borderRadius: radius.md,
        padding: spacing.md,
        borderColor: checked ? theme.primary : colors.border,
        backgroundColor: disabled ? colors.bg : checked ? theme.primarySoft : colors.card,
      }}
    >
      <View style={{ width: 20, height: 20, marginTop: 1, borderRadius: 10, borderWidth: 2, borderColor: checked ? theme.primary : disabled ? colors.border : colors.faint, alignItems: "center", justifyContent: "center" }}>
        {checked && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.primary }} />}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: disabled ? colors.muted : colors.text }}>{info.label}</Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>{about}</Text>
      </View>
    </Pressable>
  );
}

/**
 * A group's name and description, and on a new group who can join it. Who can join is fixed once the group exists, because
 * opening an invite-only group would show its history to anyone, so editing shows it without a way to change it.
 */
export function GroupForm({
  initial,
  visibility: fixed,
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
  notice?: string;
  submitLabel: string;
  onSubmit: (v: Output) => Promise<void>;
}) {
  const editing = fixed !== undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // Nothing chosen to start with on a new group: it can't be changed later, so it's a decision, not a default.
  const [visibility, setVisibility] = useState<ChatGroupVisibility | "">(fixed ?? "");
  const { errors, serverError, busy, fromZod, run } = useFormErrors();

  const submit = () =>
    run(async () => {
      const parsed = chatGroupCreateSchema.safeParse({ name, description, visibility });
      if (!parsed.success) return fromZod(parsed.error);
      await onSubmit(parsed.data);
    });

  return (
    <View style={{ gap: spacing.lg }}>
      {/* Off, so the web build's browser doesn't keep what's written here for session restore, where it would outlast sign-out. */}
      <Input label="Group name" value={name} onChangeText={setName} maxLength={CHAT_GROUP_NAME_MAX_LENGTH} error={errors.name} autoComplete="off" />
      <Input
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={CHAT_GROUP_DESCRIPTION_MAX_LENGTH}
        autoComplete="off"
        hint={`What the group is for. Optional. ${description.length} / ${CHAT_GROUP_DESCRIPTION_MAX_LENGTH}`}
        error={errors.description}
      />
      <View accessibilityRole="radiogroup" accessibilityLabel="Who can join" style={{ gap: spacing.sm }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#334155" }}>Who can join{editing ? "" : " *"}</Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>{editing ? "This was chosen when the group was created, and can't be changed." : "You can't change this after the group is created."}</Text>
        {CHAT_GROUP_VISIBILITIES.map((v) => {
          const off = editing ? v !== fixed : !available.includes(v);
          return <VisibilityChoice key={v} value={v} checked={visibility === v} disabled={off} note={!editing && off ? unavailableNote : undefined} onPress={() => setVisibility(v)} />;
        })}
        <ErrorText error={errors.visibility} />
      </View>
      {notice ? (
        <View style={{ backgroundColor: "#fef3c7", borderRadius: radius.md, padding: spacing.md }}>
          <Text style={{ fontSize: 13, color: "#92400e" }}>{notice}</Text>
        </View>
      ) : null}
      <ErrorText error={serverError} />
      <Button title={submitLabel} loading={busy} onPress={() => void submit()} />
    </View>
  );
}
