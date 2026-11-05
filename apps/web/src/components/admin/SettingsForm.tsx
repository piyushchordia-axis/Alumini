import {
  APPROVAL_MODE_OPTIONS,
  featureBlockedText,
  featureHelpText,
  fieldErrorsFrom,
  settingsDraftOf,
  settingsSave,
  TENANT_FEATURE_LABELS as FEATURE_LABELS,
  TENANT_FEATURES,
  toggleFeature,
  type ApprovalMode,
  type SettingsDraft,
  type TenantFeature,
  type TenantFeatures,
  type TenantSettingsDto,
  type TenantSettingsUpdate,
  type TenantType,
} from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useId, useState } from "react";
import { Button, Checkbox, FormField, Input, Select } from "@/components/ui";
import { toast } from "@/stores/uiStore";

/** One switch. A key whose prerequisite is off can't be turned on, and says what it needs outside its label, so the label stays its name alone. */
function FeatureCheckbox({ feature, features, error, onChange }: { feature: TenantFeature; features: TenantFeatures; error?: string; onChange: (next: TenantFeatures) => void }) {
  const hintId = useId();
  const blocked = featureBlockedText(features, feature);
  return (
    <div>
      <Checkbox
        checked={features[feature]}
        disabled={!!blocked}
        aria-describedby={blocked || error ? hintId : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(toggleFeature(features, feature, e.target.checked))}
        label={FEATURE_LABELS[feature]}
        className={blocked ? "opacity-60" : undefined}
      />
      {(blocked || error) && (
        <p id={hintId} className={error ? "ml-6 text-xs text-red-600" : "ml-6 text-xs text-slate-500"} role={error ? "alert" : undefined}>
          {error ?? blocked}
        </p>
      )}
    </div>
  );
}

function ModeSelect({ which, value, onChange }: { which: keyof typeof APPROVAL_MODE_OPTIONS; value: ApprovalMode; onChange: (mode: ApprovalMode) => void }) {
  const { label, hint, options } = APPROVAL_MODE_OPTIONS[which];
  return (
    <FormField label={label} hint={hint}>
      <Select value={value} onChange={(e) => onChange(e.target.value as ApprovalMode)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

export function SettingsForm({ initial, tenantType, onSubmit }: { initial: TenantSettingsDto; tenantType: TenantType; onSubmit: (input: TenantSettingsUpdate) => Promise<unknown> }) {
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraftOf(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        // Checked before sending: a blank year would otherwise go as 0.
        const result = settingsSave(initial, draft);
        if (result.errors) {
          setErrors(result.errors);
          return;
        }
        setErrors({});
        setBusy(true);
        try {
          await onSubmit(result.input);
          toast.success("Settings saved");
        } catch (err) {
          // By the whole path, so a refused switch's error ("features.mentorship") shows under that switch.
          setErrors(fieldErrorsFrom(err));
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <ModeSelect which="member" value={draft.memberApprovalMode} onChange={(v) => set("memberApprovalMode", v)} />
        <ModeSelect which="content" value={draft.contentModerationMode} onChange={(v) => set("contentModerationMode", v)} />
        <FormField label="Earliest batch year" error={errors.minBatchYear}>
          <Input type="number" inputMode="numeric" value={draft.minBatchYear} invalid={!!errors.minBatchYear} onChange={(e) => set("minBatchYear", e.target.value)} />
        </FormField>
        <FormField label="Latest batch year" error={errors.maxBatchYear}>
          <Input type="number" inputMode="numeric" value={draft.maxBatchYear} invalid={!!errors.maxBatchYear} onChange={(e) => set("maxBatchYear", e.target.value)} />
        </FormField>
      </div>
      <Checkbox checked={draft.allowSelfRegistration} onChange={(e) => set("allowSelfRegistration", e.target.checked)} label="Allow alumni to register themselves (turn off to onboard members manually only)" />
      <Checkbox
        checked={draft.inviteAutoApprove}
        onChange={(e) => set("inviteAutoApprove", e.target.checked)}
        label="Approve invited alumni straight away (they sign in with the phone number you invited, even when self-registration is off)"
      />
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Enabled features</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TENANT_FEATURES.map((f) => (
            <FeatureCheckbox key={f} feature={f} features={draft.features} error={errors[`features.${f}`]} onChange={(next) => set("features", next)} />
          ))}
        </div>
        {featureHelpText(tenantType).map((text) => (
          <p key={text} className="mt-2 text-xs text-slate-500">
            {text}
          </p>
        ))}
      </fieldset>
      <Button type="submit" loading={busy}>
        Save settings
      </Button>
    </form>
  );
}
