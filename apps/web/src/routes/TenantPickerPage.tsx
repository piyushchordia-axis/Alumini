import { countryName, tenantSearchEmpty } from "@illuminize/shared";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { IconBuilding, IconChevronRight, IconSearch, IconSpark } from "@/components/icons";
import { Avatar, Button, Card, EmptyState, ErrorBox, Input, ListSkeleton } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { useTenantList } from "@/hooks/useTenant";
import { resetTheme } from "@/lib/theme";
import { useIsAuthenticated } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";

export function TenantPickerPage() {
  const [q, setQ] = useState("");
  // A moment after the typing stops, so a search that finds nothing is read out once, not at every letter.
  const search = useDebounced(q.trim());
  const tenants = useTenantList(search || undefined);
  const searchBox = useRef<HTMLInputElement>(null);
  const empty = tenantSearchEmpty(!!search);
  const last = useUiStore((s) => s.lastTenantSlug);
  const authed = useIsAuthenticated();
  const [params] = useSearchParams();
  // Coming back from an institution leaves its colours applied; the picker uses the Illuminize defaults.
  useEffect(() => {
    resetTheme();
  }, []);

  if (authed && last && params.get("switch") !== "1") return <Navigate to={`/t/${last}/app`} replace />;

  return (
    <div className="min-h-full bg-slate-50">
      <div className="bg-gradient-to-br from-primary to-secondary px-4 py-14 text-white">
        <div className="mx-auto max-w-2xl text-center">
          <IconSpark size={40} className="mx-auto block" />
          <h1 className="mt-3 text-3xl font-semibold">Illuminize</h1>
          <p className="mt-2 text-white/80">Your alumni network. Pick your university, college or school to get started.</p>
        </div>
      </div>
      <div className="mx-auto -mt-6 max-w-2xl px-4 pb-16">
        <Card className="p-4">
          <Input ref={searchBox} placeholder="Search by name or city…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search institutions" />
        </Card>
        <div className="mt-4 space-y-2">
          {tenants.isLoading && <ListSkeleton shape="row" count={4} />}
          {tenants.error && <ErrorBox error={tenants.error} />}
          {tenants.data?.length === 0 && (
            <EmptyState
              icon={empty.live ? <IconSearch /> : <IconBuilding />}
              title={empty.title}
              description={empty.description}
              live={empty.live}
              action={
                empty.action && (
                  <Button
                    variant={empty.action.variant}
                    onClick={() => {
                      setQ("");
                      searchBox.current?.focus();
                    }}
                  >
                    {empty.action.label}
                  </Button>
                )
              }
            />
          )}
          {tenants.data?.map((t) => (
            <Link key={t.id} to={`/t/${t.slug}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow">
              <Avatar name={t.shortName ?? t.name} src={t.logoUrl} brandColor={t.primaryColor} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-900">{t.name}</div>
                <div className="text-sm text-slate-500">
                  {[t.city, countryName(t.country)].filter(Boolean).join(", ")}
                </div>
              </div>
              <IconChevronRight size={16} className="text-slate-400" />
            </Link>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-slate-500">
          Illuminize staff?{" "}
          <Link to="/platform/login" className="underline">
            Platform console
          </Link>
        </p>
      </div>
    </div>
  );
}
