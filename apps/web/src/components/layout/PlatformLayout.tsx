import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { resetTheme } from "@/lib/theme";
import { useAuthStore } from "@/stores/authStore";

export function PlatformLayout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  useEffect(() => {
    resetTheme();
  }, []);
  const items = [
    { to: "/platform/tenants", label: "Institutions", icon: "🏛️" },
    { to: "/platform/users", label: "Users", icon: "👤" },
    { to: "/platform/stats", label: "Stats", icon: "📈" },
    { to: "/platform/audit", label: "Audit log", icon: "📜" },
  ];
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition", isActive ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white");
  return (
    <div className="min-h-full bg-slate-50">
      <header className="sticky top-0 z-40 bg-slate-900 text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <span className="text-xl">✨</span>
          <span className="font-semibold">Illuminize</span>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">Platform console</span>
          <span className="ml-auto text-sm text-slate-300">{user?.phone}</span>
          <button
            className="text-sm text-slate-300 hover:text-white"
            onClick={async () => {
              await api.auth.logout(refreshToken);
              qc.clear();
              navigate("/platform/login");
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <aside className="w-full shrink-0 md:w-56">
          <nav className="flex gap-1 overflow-x-auto rounded-xl bg-slate-800 p-2 md:flex-col">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} className={linkClass}>
                <span>{i.icon}</span>
                <span className="whitespace-nowrap">{i.label}</span>
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
