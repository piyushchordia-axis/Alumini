import { ADMIN_SECTIONS } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { IconChevronLeft, NavIcon } from "@/components/icons";
import { Avatar } from "@/components/ui";
import { useAdminTenant } from "@/hooks/useAdminTenant";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { usePollInterval } from "@/lib/realtime";

export function AdminLayout() {
  const { tenant, me, isPlatformAdmin } = useAdminTenant();
  const base = `/t/${tenant.slug}/admin`;
  const pollInterval = usePollInterval();
  const dashboard = useQuery({ queryKey: qk.admin.dashboard(tenant.slug), queryFn: () => api.admin.dashboard(tenant.slug), refetchInterval: pollInterval });
  const d = dashboard.data;
  const items = ADMIN_SECTIONS.map((s) => ({ to: `${base}/${s.path}`, label: s.label, icon: s.icon, count: s.countKey ? d?.[s.countKey] : undefined }));
  const { pathname } = useLocation();
  const nav = useRef<HTMLElement>(null);
  // On a phone the sections are one strip that scrolls sideways: keep the open one in it, as scrollIntoView's inline
  // "nearest" would, but without scrolling the page up to the strip. Again when the counts arrive, as they widen it.
  useEffect(() => {
    const strip = nav.current;
    const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    const pad = parseFloat(getComputedStyle(strip).paddingLeft) || 0;
    const box = strip.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.left < box.left + pad) strip.scrollLeft -= box.left + pad - item.left;
    else if (item.right > box.right - pad) strip.scrollLeft += item.right - (box.right - pad);
  }, [pathname, d]);
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
      isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
    );
  const headerLink = "inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-slate-600 hover:text-slate-900";
  return (
    <div className="min-h-full bg-[var(--surface-page)]">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Avatar name={tenant.shortName ?? tenant.name} src={tenant.logoUrl} size="sm" />
          <span className="font-display truncate font-semibold text-slate-900">{tenant.shortName ?? tenant.name}</span>
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">Admin</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {/* Staff who aren't members came from the platform console, so for them it's the way back. */}
            {isPlatformAdmin && (
              <NavLink to="/platform/tenants" className={headerLink} aria-label="Platform console">
                {!me && <IconChevronLeft size={16} />}
                <span className="sm:hidden">Platform</span>
                <span className="hidden sm:inline">Platform console</span>
              </NavLink>
            )}
            {me && (
              <NavLink to={`/t/${tenant.slug}/app`} className={headerLink}>
                <IconChevronLeft size={16} />
                Back to app
              </NavLink>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:py-6">
        <aside className="w-full shrink-0 md:w-56">
          <nav ref={nav} aria-label="Admin sections" className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0 md:flex-col md:space-y-0.5">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} className={linkClass}>
                <NavIcon name={i.icon} size={16} />
                <span className="whitespace-nowrap">{i.label}</span>
                {!!i.count && <span aria-label={`${i.count} waiting`} className="ml-auto rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{i.count}</span>}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
