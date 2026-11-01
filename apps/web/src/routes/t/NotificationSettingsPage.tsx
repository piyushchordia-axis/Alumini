import { CONFIGURABLE_CATEGORIES, NOTIFICATION_CATEGORY_INFO, type NotificationLevel, type NotificationPrefsDto, type NotificationPrefsUpdate } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { Card, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

const LEVEL_LABELS: Record<NotificationLevel, string> = { OFF: "Off", IN_APP: "In app", IN_APP_PUSH: "In app + push" };
const RANK: Record<NotificationLevel, number> = { OFF: 0, IN_APP: 1, IN_APP_PUSH: 2 };

function LevelPicker({ name, value, min, onChange }: { name: string; value: NotificationLevel; min: NotificationLevel; onChange: (v: NotificationLevel) => void }) {
  const options = (["OFF", "IN_APP", "IN_APP_PUSH"] as const).filter((l) => RANK[l] >= RANK[min]);
  return (
    <div role="radiogroup" aria-label={name} className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          onClick={() => onChange(l)}
          className={clsx("rounded-md px-3 py-1.5 text-xs font-medium transition", value === l ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}
        >
          {LEVEL_LABELS[l]}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={clsx("flex items-start justify-between gap-4 py-3", disabled && "opacity-60")}>
      <span>
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="block text-sm text-slate-500">{description}</span>
      </span>
      <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-primary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function NotificationSettingsPage() {
  const { tenant, isTenantAdmin } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: qk.notificationPrefs(slug), queryFn: () => api.notifications.prefs(slug) });
  const save = useMutation({
    mutationFn: (input: NotificationPrefsUpdate) => api.notifications.updatePrefs(slug, input),
    onMutate: async (input) => {
      // Optimistic: the switch moves immediately; rolled back on error.
      await qc.cancelQueries({ queryKey: qk.notificationPrefs(slug) });
      const previous = qc.getQueryData<NotificationPrefsDto>(qk.notificationPrefs(slug));
      if (previous) qc.setQueryData(qk.notificationPrefs(slug), { ...previous, ...input, categories: { ...previous.categories, ...input.categories } });
      return { previous };
    },
    onError: (e, _v, c) => {
      if (c?.previous) qc.setQueryData(qk.notificationPrefs(slug), c.previous);
      toast.error(errorMessage(e));
    },
    onSuccess: (data) => qc.setQueryData(qk.notificationPrefs(slug), data),
  });
  if (prefs.isLoading) return <Loading />;
  if (prefs.error || !prefs.data) return <ErrorBox error={prefs.error ?? "Not found"} />;
  const p = prefs.data;
  const categories = CONFIGURABLE_CATEGORIES.filter((c) => isTenantAdmin || !NOTIFICATION_CATEGORY_INFO[c].adminOnly);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Notification settings" subtitle={`For ${tenant.name}. Account notices (approvals, moderation decisions) always reach you.`} />
      <Card className="divide-y divide-slate-100 px-5">
        {categories.map((c) => {
          const info = NOTIFICATION_CATEGORY_INFO[c];
          return (
            <div key={c} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-slate-900">{info.label}</div>
                <div className="text-sm text-slate-500">{info.description}</div>
              </div>
              <LevelPicker name={info.label} value={p.categories[c]} min={info.minLevel} onChange={(level) => save.mutate({ categories: { [c]: level } })} />
            </div>
          );
        })}
      </Card>
      <Card className="divide-y divide-slate-100 px-5">
        <div className="py-4">
          <h2 className="font-semibold text-slate-900">Email and messages</h2>
          {!p.hasEmail && (
            <p className="mt-1 text-sm text-amber-800">
              Add and confirm an email on <Link to={`/t/${slug}/app/profile`} className="underline">your profile</Link> to get these by email.
            </p>
          )}
        </div>
        <Toggle label="Weekly digest" description="Top posts, new jobs and upcoming events, every Monday morning." checked={p.digestEmail} disabled={!p.hasEmail} onChange={(v) => save.mutate({ digestEmail: v })} />
        <Toggle
          label="Announcements by email or WhatsApp"
          description="When admins also send an announcement outside the app."
          checked={p.announcementMessages}
          onChange={(v) => save.mutate({ announcementMessages: v })}
        />
      </Card>
    </div>
  );
}
