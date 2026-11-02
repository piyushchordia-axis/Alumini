import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BrandingForm } from "@/components/admin/BrandingForm";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { Card, ErrorBox, Loading, PageHeader, Tabs } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

export function AdminSettingsPage() {
  const { tenant } = useAdminTenant();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const [tab, setTab] = useState<"settings" | "branding">("settings");
  const q = useQuery({ queryKey: qk.admin.settings(slug), queryFn: () => api.admin.settings.get(slug) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.admin.settings(slug) });
    void qc.invalidateQueries({ queryKey: qk.tenant(slug) });
    void qc.invalidateQueries({ queryKey: qk.tenants });
  };
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? "Failed"} />;
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="Approval rules, features and how your institution looks" />
      <Card className="p-4 text-sm text-slate-700">
        <span className="font-medium text-slate-900">Your plan includes: </span>
        in-app notifications and push
        {q.data.outboundChannels.length > 0 && `, plus ${q.data.outboundChannels.map((c) => ({ WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "email" })[c]).join(", ")} for invites and announcements`}
        .{" "}
        <span className="text-slate-500">{q.data.outboundChannels.length === 0 ? "Ask the Illuminize team to add WhatsApp, SMS or email messaging." : "Messages are billed per delivery."}</span>
      </Card>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "settings", label: "Approvals & features" }, { value: "branding", label: "Branding" }]} className="w-fit" />
      <Card className="p-5">
        {tab === "settings" ? (
          <SettingsForm
            key={q.data.settings.updatedAt}
            initial={q.data.settings}
            tenantType={tenant.type}
            onSubmit={async (input) => {
              await api.admin.settings.update(slug, input);
              refresh();
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
