import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Avatar, Modal } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { usePollInterval } from "@/lib/realtime";
import { enabledSections, homePath } from "@/lib/sections";
import { useAuthStore } from "@/stores/authStore";

/** Phones show this many sections in the bottom bar; the rest go into the "More" sheet. */
const BOTTOM_BAR_SECTIONS = 4;

export function HomeLayout() {
  const { tenant, membership, isTenantAdmin } = useMembership();
  const base = `/t/${tenant.slug}/app`;
  const sections = enabledSections(tenant.settings.features).map((s) => ({ ...s, to: `${base}/${s.path}` }));
  const barSections = sections.length > BOTTOM_BAR_SECTIONS + 1 ? sections.slice(0, BOTTOM_BAR_SECTIONS) : sections;
  const overflow = sections.slice(barSections.length);

  const pollInterval = usePollInterval();
  const unread = useQuery({ queryKey: qk.unread(tenant.slug), queryFn: () => api.notifications.unreadCount(tenant.slug), refetchInterval: pollInterval });
  const unreadCount = unread.data?.count ?? 0;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const [moreOpen, setMoreOpen] = useState(false);

  const signOut = async () => {
    try {
      await api.auth.logout(refreshToken);
    } catch {
      // The local session is cleared even when the server can't be reached.
    } finally {
      qc.clear();
      navigate(`/t/${tenant.slug}`);
    }
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition", isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-100");
  const sheetLink = "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100";

  return (
    <div className="min-h-full bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <NavLink to={homePath(tenant.slug, tenant.settings.features)} className="flex min-w-0 items-center gap-2">
            <Avatar name={tenant.shortName ?? tenant.name} src={tenant.logoUrl} size="sm" />
            <span className="truncate font-semibold text-slate-900">{tenant.shortName ?? tenant.name}</span>
          </NavLink>
          <div className="ml-auto flex items-center gap-1">
            {isTenantAdmin && (
              <NavLink to={`/t/${tenant.slug}/admin`} className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:block">
                Admin
              </NavLink>
            )}
            <NavLink to={`${base}/notifications`} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}>
              <span aria-hidden>🔔</span>
              {!!unreadCount && (
                <span aria-hidden className="absolute -right-0.5 -top-0.5 rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </NavLink>
            <NavLink to={`${base}/profile`} className="rounded-full" aria-label="My profile">
              <Avatar name={membership.fullName} src={membership.avatarUrl} size="sm" />
            </NavLink>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="space-y-1" aria-label="Main">
            {sections.map((i) => (
              <NavLink key={i.to} to={i.to} className={linkClass}>
                <span aria-hidden>{i.icon}</span>
                {i.label}
              </NavLink>
            ))}
            {sections.length > 0 && <div className="my-3 border-t border-slate-200" />}
            <NavLink to={`${base}/my-content`} className={linkClass}>
              <span aria-hidden>🗂️</span>My posts
            </NavLink>
            <NavLink to={`${base}/profile`} className={linkClass}>
              <span aria-hidden>👤</span>My profile
            </NavLink>
            {isTenantAdmin && (
              <NavLink to={`/t/${tenant.slug}/admin`} className={linkClass}>
                <span aria-hidden>🛡️</span>Admin console
              </NavLink>
            )}
            <NavLink to="/?switch=1" className={linkClass({ isActive: false })}>
              <span aria-hidden>🔁</span>Switch institution
            </NavLink>
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100" onClick={() => void signOut()}>
              <span aria-hidden>🚪</span>Sign out
            </button>
          </nav>
        </aside>
        <main className="min-w-0 flex-1 pb-20 md:pb-0">
          <Outlet />
        </main>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {barSections.map((i) => (
          <NavLink key={i.to} to={i.to} className={({ isActive }) => clsx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", isActive ? "text-primary" : "text-slate-500")}>
            <span className="text-lg leading-none" aria-hidden>
              {i.icon}
            </span>
            {i.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen} className={clsx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", moreOpen ? "text-primary" : "text-slate-500")}>
          <span className="text-lg leading-none" aria-hidden>
            ☰
          </span>
          More
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title={tenant.shortName ?? tenant.name}>
        {/* Following any link in the sheet closes it. */}
        <div className="space-y-1" onClick={(e) => (e.target as HTMLElement).closest("a") && setMoreOpen(false)}>
          {overflow.map((i) => (
            <NavLink key={i.to} to={i.to} className={sheetLink}>
              <span aria-hidden>{i.icon}</span>
              {i.label}
            </NavLink>
          ))}
          <NavLink to={`${base}/my-content`} className={sheetLink}>
            <span aria-hidden>🗂️</span>My posts
          </NavLink>
          <NavLink to={`${base}/profile`} className={sheetLink}>
            <span aria-hidden>👤</span>My profile
          </NavLink>
          {isTenantAdmin && (
            <NavLink to={`/t/${tenant.slug}/admin`} className={sheetLink}>
              <span aria-hidden>🛡️</span>Admin console
            </NavLink>
          )}
          <NavLink to="/?switch=1" className={sheetLink}>
            <span aria-hidden>🔁</span>Switch institution
          </NavLink>
          <button type="button" className={clsx(sheetLink, "w-full text-left text-red-600")} onClick={() => void signOut()}>
            <span aria-hidden>🚪</span>Sign out
          </button>
        </div>
      </Modal>
    </div>
  );
}
