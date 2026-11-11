import { planChannelsSentence } from "@illuminize/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BrandingForm } from "@/components/admin/BrandingForm";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { PageLoad } from "@/components/common/PageLoad";
import { Card, PageHeader, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { usePageQuery } from "@/hooks/usePageQuery";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function AdminSettingsPage() {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const [tab, setTab] = useState<"settings" | "branding">("settings");
  const q = useQuery({ queryKey: qk.admin.settings(slug), queryFn: () => api.admin.settings.get(slug) });
  const page = usePageQuery(q);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.admin.settings(slug) });
    void qc.invalidateQueries({ queryKey: qk.tenant(slug) });
    void qc.invalidateQueries({ queryKey: qk.tenants });
    // The dashboard's approval sentence.
    void qc.invalidateQueries({ queryKey: qk.admin.dashboard(slug) });
  };
  const header = <PageHeader title="Settings" subtitle="Approval rules, features and how your institution looks" />;
  // Only with nothing to show: a refetch failing in the background keeps the forms and what was typed in them.
  if (!q.data)
    return (
      <div className="space-y-4">
        {header}
        <PageLoad page={page} shape="form" />
      </div>
    );
  const plan = planChannelsSentence(q.data.outboundChannels);
  return (
    <div className="space-y-4">
      {header}
      <Card className="p-4 text-sm text-slate-700">
        {plan.sentence.map((part, i) =>
          part.strong ? (
            <span key={i} className="font-medium text-slate-900">
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}{" "}
        <span className="text-slate-500">{plan.note}</span>
      </Card>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "settings", label: "Approvals & features" }, { value: "branding", label: "Branding" }]} className="w-fit" />
      <Card className="p-5">
        {tab === "settings" ? (
          <SettingsForm
            key={q.data.settings.updatedAt}
            initial={q.data.settings}
            tenantType={tenant.type}
            onSubmit={async (input) => {
              try {
                await api.admin.settings.update(slug, input);
              } finally {
                // Refused too: the page may be stale (Messaging switched off in another tab, say), and the form remounts on what's saved.
                refresh();
              }
            }}
          />
        ) : (
          <BrandingForm
            key={q.data.branding.name + q.data.branding.primaryColor}
            initial={q.data.branding}
            onSubmit={async (input) => {
              await api.admin.settings.updateBranding(slug, input);
              refresh();
            }}
          />
        )}
      </Card>
    </div>
  );
}
