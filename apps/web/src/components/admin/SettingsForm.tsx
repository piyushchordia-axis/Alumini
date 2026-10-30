import type { APPROVAL_MODES} from "@illuminize/shared";
import { TENANT_FEATURES, type TenantFeature, type TenantSettingsDto, type TenantSettingsUpdate } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useState } from "react";
import { Button, Checkbox, FormField, Input, Select } from "@/components/ui";
import { toast } from "@/stores/uiStore";

const FEATURE_LABELS: Record<TenantFeature, string> = { feed: "Community feed", jobs: "Jobs", funding: "Funding", events: "Events & meetups", directory: "Member directory" };

export function SettingsForm({ initial, onSubmit }: { initial: TenantSettingsDto; onSubmit: (input: TenantSettingsUpdate) => Promise<unknown> }) {
  const [memberApprovalMode, setMemberApprovalMode] = useState(initial.memberApprovalMode);
  const [contentModerationMode, setContentModerationMode] = useState(initial.contentModerationMode);
  const [allowSelfRegistration, setAllowSelfRegistration] = useState(initial.allowSelfRegistration);
  const [minBatchYear, setMinBatchYear] = useState(String(initial.minBatchYear));
  const [maxBatchYear, setMaxBatchYear] = useState(String(initial.maxBatchYear));
  const [features, setFeatures] = useState(initial.features);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit({ memberApprovalMode, contentModerationMode, allowSelfRegistration, minBatchYear: Number(minBatchYear), maxBatchYear: Number(maxBatchYear), features });
          toast.success("Settings saved");
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="New member approval" hint="Who can get in: everyone instantly, or only after an admin approves.">
          <Select value={memberApprovalMode} onChange={(e) => setMemberApprovalMode(e.target.value as (typeof APPROVAL_MODES)[number])}>
            <option value="AUTO_APPROVE">Auto-approve members</option>
            <option value="ADMIN_APPROVAL">Admin must approve members</option>
          </Select>
        </FormField>
        <FormField label="Content moderation" hint="Applies to posts, jobs, funding and events. Comments are never held.">
          <Select value={contentModerationMode} onChange={(e) => setContentModerationMode(e.target.value as (typeof APPROVAL_MODES)[number])}>
            <option value="AUTO_APPROVE">Publish immediately</option>
            <option value="ADMIN_APPROVAL">Admin must approve before publishing</option>
          </Select>
        </FormField>
        <FormField label="Earliest batch year">
          <Input type="number" value={minBatchYear} onChange={(e) => setMinBatchYear(e.target.value)} />
        </FormField>
        <FormField label="Latest batch year">
          <Input type="number" value={maxBatchYear} onChange={(e) => setMaxBatchYear(e.target.value)} />
        </FormField>
      </div>
      <Checkbox checked={allowSelfRegistration} onChange={(e) => setAllowSelfRegistration(e.target.checked)} label="Allow alumni to register themselves (turn off to onboard members manually only)" />
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">Enabled features</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TENANT_FEATURES.map((f) => (
            <Checkbox key={f} checked={features[f]} onChange={(e) => setFeatures({ ...features, [f]: e.target.checked })} label={FEATURE_LABELS[f]} />
          ))}
        </div>
      </fieldset>
      <Button type="submit" loading={busy}>
        Save settings
      </Button>
    </form>
  );
}
