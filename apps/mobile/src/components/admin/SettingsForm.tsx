import { APPROVAL_MODE_OPTIONS, featureHelpText, fieldErrorsFrom, settingsDraftOf, settingsSave, type SettingsDraft, type TenantSettingsDto, type TenantSettingsUpdate, type TenantType } from "@illuminize/shared";
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { FeatureSwitches } from "@/components/admin/FeatureSwitches";
import { RadioGroup } from "@/components/RadioGroup";
import { Button, Card, Choice, Input, Muted, headingRole } from "@/components/ui";
import { colors, spacing } from "@/theme";

const digitsOnly = (text: string) => text.replace(/\D/g, "");
// The web export has no number pad: inputMode asks a phone's browser for its numeric keyboard.
const numericOnWeb = Platform.OS === "web" ? ({ inputMode: "numeric" } as object) : {};

/**
 * The console's approvals and feature switches, as the web's SettingsForm. Keyed by the screen on the settings'
 * `updatedAt`, so a save (or a refusal another admin's change explains) starts it again from what's stored. What became
 * of Save is the screen's to say, under this form, as it outlasts that: `onInvalid` hands it a problem found before
 * sending, and `onSubmit` says how the API answered.
 */
export function SettingsForm({
  initial,
  tenantType,
  onInvalid,
  onSubmit,
}: {
  initial: TenantSettingsDto;
  tenantType: TenantType;
  onInvalid: (problem: string) => void;
  onSubmit: (input: TenantSettingsUpdate) => Promise<void>;
}) {
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraftOf(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    const result = settingsSave(initial, draft);
    if (result.errors) {
      setErrors(result.errors);
      // Said by Save too, where the admin is looking: the box it's about may be off screen.
      onInvalid(Object.values(result.errors)[0] ?? "Check the settings above");
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(result.input);
    } catch (err) {
      // By the whole path, so a refused switch's error ("features.mentorship") lands under that switch. Lost if the
      // refusal's refetch starts the form again, but the screen has said it.
      setErrors(fieldErrorsFrom(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.lg }}>
      <Card>
        <Text {...headingRole(2)} style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>
          Approvals
        </Text>
        <RadioGroup {...APPROVAL_MODE_OPTIONS.member} value={draft.memberApprovalMode} onChange={(v) => set("memberApprovalMode", v)} error={errors.memberApprovalMode} />
        <RadioGroup {...APPROVAL_MODE_OPTIONS.content} value={draft.contentModerationMode} onChange={(v) => set("contentModerationMode", v)} error={errors.contentModerationMode} />
        <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Input
              label="Earliest batch year"
              value={draft.minBatchYear}
              onChangeText={(t) => set("minBatchYear", digitsOnly(t))}
              keyboardType="number-pad"
              {...numericOnWeb}
              maxLength={4}
              error={errors.minBatchYear}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Latest batch year"
              value={draft.maxBatchYear}
              onChangeText={(t) => set("maxBatchYear", digitsOnly(t))}
              keyboardType="number-pad"
              {...numericOnWeb}
              maxLength={4}
              error={errors.maxBatchYear}
            />
          </View>
        </View>
        <Choice kind="checkbox" label="Allow alumni to register themselves (turn off to onboard members manually only)" checked={draft.allowSelfRegistration} onPress={() => set("allowSelfRegistration", !draft.allowSelfRegistration)} />
        <Choice
          kind="checkbox"
          label="Approve invited alumni straight away (they sign in with the phone number you invited, even when self-registration is off)"
          checked={draft.inviteAutoApprove}
          onPress={() => set("inviteAutoApprove", !draft.inviteAutoApprove)}
        />
      </Card>
      <Card>
        <Text {...headingRole(2)} style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>
          Enabled features
        </Text>
        <FeatureSwitches features={draft.features} onChange={(next) => set("features", next)} errors={errors} />
        {featureHelpText(tenantType).map((text) => (
          <Muted key={text}>{text}</Muted>
        ))}
      </Card>
      <Button title="Save settings" loading={busy} onPress={() => void save()} />
    </View>
  );
}
