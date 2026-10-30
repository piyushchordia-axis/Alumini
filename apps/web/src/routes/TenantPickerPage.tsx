import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Avatar, Card, EmptyState, ErrorBox, Input, Loading } from "@/components/ui";
import { useTenantList } from "@/hooks/useTenant";
import { useIsAuthenticated } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";

export function TenantPickerPage() {
  const [q, setQ] = useState("");
  const tenants = useTenantList(q.trim() || undefined);
  const last = useUiStore((s) => s.lastTenantSlug);
  const authed = useIsAuthenticated();
  const params = new URLSearchParams(window.location.search);

  if (authed && last && params.get("switch") !== "1") return <Navigate to={`/t/${last}/app`} replace />;

  return (
    <div className="min-h-full bg-slate-50">
      <div className="bg-gradient-to-br from-primary to-secondary px-4 py-14 text-white">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-4xl">✨</div>
          <h1 className="mt-3 text-3xl font-semibold">Illuminize</h1>
          <p className="mt-2 text-white/80">Your alumni network. Pick your university, college or school to get started.</p>
        </div>
      </div>
      <div className="mx-auto -mt-6 max-w-2xl px-4 pb-16">
        <Card className="p-4">
          <Input placeholder="Search by name or city…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search institutions" />
        </Card>
        <div className="mt-4 space-y-2">
          {tenants.isLoading && <Loading />}
          {tenants.error && <ErrorBox error={tenants.error} />}
          {tenants.data?.length === 0 && <EmptyState title="No institutions found" description="Try a different search, or ask your alumni office to join Illuminize." />}
          {tenants.data?.map((t) => (
            <Link key={t.id} to={`/t/${t.slug}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow">
              <Avatar name={t.shortName ?? t.name} src={t.logoUrl} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-900">{t.name}</div>
                <div className="text-sm text-slate-500">
                  {[t.city, t.country].filter(Boolean).join(", ")}
                </div>
              </div>
              <span className="text-slate-400">›</span>
            </Link>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-slate-400">
          Illuminize staff?{" "}
          <Link to="/platform/login" className="underline">
            Platform console
          </Link>
        </p>
      </div>
    </div>
  );
}
