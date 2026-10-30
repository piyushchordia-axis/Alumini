import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Avatar } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useAuthStore } from "@/stores/authStore";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  enabled: boolean;
}

export function HomeLayout() {
  const { tenant, membership, isTenantAdmin } = useMembership();
  const base = `/t/${tenant.slug}/app`;
  const f = tenant.settings.features;
  const items: NavItem[] = [
    { to: `${base}/feed`, label: "Feed", icon: "💬", enabled: f.feed },
    { to: `${base}/jobs`, label: "Jobs", icon: "💼", enabled: f.jobs },
    { to: `${base}/funding`, label: "Funding", icon: "🚀", enabled: f.funding },
    { to: `${base}/events`, label: "Events", icon: "📅", enabled: f.events },
    { to: `${base}/directory`, label: "Directory", icon: "🎓", enabled: f.directory },
  ].filter((i) => i.enabled);

  const unread = useQuery({ queryKey: qk.unread(tenant.slug), queryFn: () => api.notifications.unreadCount(tenant.slug), refetchInterval: 60_000 });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refreshToken = useAuthStore((s) => s.refreshToken);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition", isActive ? "bg-primary/10 text-primary" : "text-slate-600 hover:bg-slate-100");

  return (
    <div className="min-h-full bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <NavLink to={`${base}/feed`} className="flex min-w-0 items-center gap-2">
            <Avatar name={tenant.shortName ?? tenant.name} src={tenant.logoUrl} size="sm" />
            <span className="truncate font-semibold text-slate-900">{tenant.shortName ?? tenant.name}</span>
          </NavLink>
          <div className="ml-auto flex items-center gap-1">
            {isTenantAdmin && (
              <NavLink to={`/t/${tenant.slug}/admin`} className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:block">
                Admin
              </NavLink>
            )}
            <NavLink to={`${base}/notifications`} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Notifications">
              🔔
              {!!unread.data?.count && (
                <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">{unread.data.count > 99 ? "99+" : unread.data.count}</span>
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
          <nav className="space-y-1">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} className={linkClass}>
                <span>{i.icon}</span>
                {i.label}
              </NavLink>
            ))}
            <div className="my-3 border-t border-slate-200" />
            <NavLink to={`${base}/my-content`} className={linkClass}>
              <span>🗂️</span>My posts
            </NavLink>
            <NavLink to={`${base}/profile`} className={linkClass}>
              <span>👤</span>My profile
            </NavLink>
            {isTenantAdmin && (
              <NavLink to={`/t/${tenant.slug}/admin`} className={linkClass}>
                <span>🛡️</span>Admin console
              </NavLink>
            )}
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 hover:bg-slate-100"
              onClick={async () => {
                await api.auth.logout(refreshToken);
                qc.clear();
                navigate(`/t/${tenant.slug}`);
              }}
            >
              <span>🚪</span>Sign out
            </button>
          </nav>
        </aside>
        <main className="min-w-0 flex-1 pb-20 md:pb-0">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} className={({ isActive }) => clsx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", isActive ? "text-primary" : "text-slate-500")}>
            <span className="text-lg leading-none">{i.icon}</span>
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
