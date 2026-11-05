import { formatCount, formatPhone } from "@illuminize/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, type ComponentType } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { IconAnalytics, IconAudit, IconBuilding, IconMessages, IconProfile, IconScale, IconSpark, type IconProps } from "@/components/icons";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { resetTheme } from "@/lib/theme";
import { useAuthStore } from "@/stores/authStore";

type PlatformIcon = ComponentType<IconProps>;

/** One row is enough: the count is the page's total. */
const OPEN_CHAT_REPORTS = { status: "OPEN", page: 1, pageSize: 1 } as const;

export function PlatformLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  useEffect(() => {
    resetTheme();
  }, []);
  // Escalated reports that are open, which reach staff by email too, but this is where they're worked through.
  const openChatReports = useQuery({ queryKey: qk.platform.chatReports(OPEN_CHAT_REPORTS), queryFn: () => api.platform.chatReports.list(OPEN_CHAT_REPORTS), refetchInterval: 60_000 }).data?.total;
  const items: { to: string; label: string; icon: PlatformIcon; open?: number }[] = [
    { to: "/platform/tenants", label: "Institutions", icon: IconBuilding },
    { to: "/platform/users", label: "Users", icon: IconProfile },
    { to: "/platform/stats", label: "Stats", icon: IconAnalytics },
    { to: "/platform/compare", label: "Compare", icon: IconScale },
    { to: "/platform/chat-reports", label: "Chat reports", icon: IconMessages, open: openChatReports },
    { to: "/platform/audit", label: "Audit log", icon: IconAudit },
  ];
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
      isActive ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white",
    );
  return (
    <div className="min-h-full bg-slate-50">
      <header className="sticky top-0 z-40 bg-slate-900 text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <IconSpark size={20} />
          <span className="font-semibold">Illuminize</span>
          <span className="hidden rounded-full bg-white/15 px-2 py-0.5 text-xs sm:inline">Platform console</span>
          <span className="ml-auto hidden text-sm text-slate-300 sm:inline">{formatPhone(user?.phone)}</span>
          <button
            className="ml-auto text-sm text-slate-300 hover:text-white sm:ml-0"
            onClick={async () => {
              try {
                await api.auth.logout(refreshToken);
              } finally {
                qc.clear();
                navigate("/platform/login");
              }
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:py-6">
        <aside className="w-full shrink-0 md:w-56">
          <nav aria-label="Platform sections" className="flex gap-1 overflow-x-auto rounded-xl bg-slate-800 p-2 md:flex-col">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} className={linkClass} aria-label={i.open ? `${i.label}, ${formatCount(i.open)} open` : undefined}>
                <i.icon size={16} />
                <span className="whitespace-nowrap">{i.label}</span>
                {!!i.open && (
                  <span aria-hidden className="ml-auto rounded-full bg-amber-400 px-1.5 text-xs font-semibold text-slate-900">
                    {formatCount(i.open)}
                  </span>
                )}
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
