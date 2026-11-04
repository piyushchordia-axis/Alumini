import { chatAvailable, splitSections, type MemberSection } from "@illuminize/shared";
import { chatBadgeLabel, groupsBadgeLabel, type ChatBadgeLabel } from "@illuminize/shared/chat";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { matchPath, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { IconBell, NavIcon, type NavIconName } from "@/components/icons";
import { Avatar, Modal } from "@/components/ui";
import { useChatBadge, useChatScope } from "@/hooks/useChat";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { useMentorsWayOut } from "@/lib/mentors";
import { qk } from "@/lib/queryKeys";
import { usePollInterval } from "@/lib/realtime";
import { useAppRouteHandle } from "@/lib/routeHandle";
import { homePath, SECTION_LINKS } from "@/lib/sections";
import { useAuthStore } from "@/stores/authStore";

function NavLabel({ icon, label }: { icon: NavIconName; label: string }) {
  return (
    <>
      <NavIcon name={icon} size={18} className="opacity-90" />
      <span>{label}</span>
    </>
  );
}

export function HomeLayout() {
  const { tenant, membership, isTenantAdmin } = useMembership();
  const base = `/t/${tenant.slug}/app`;
  const toLink = (section: MemberSection) => ({ ...SECTION_LINKS[section], section, to: `${base}/${SECTION_LINKS[section].path}` });
  const { bar, overflow } = splitSections(tenant.settings.features, membership.chatEligible, { mentorsWayOut: useMentorsWayOut() });
  const barLinks = bar.map(toLink);
  const overflowLinks = overflow.map(toLink);
  const sections = [...barLinks, ...overflowLinks];

  const chatEnabled = chatAvailable(tenant.settings.features, membership.chatEligible);
  useChatScope(tenant.slug, chatEnabled);
  const badgeData = useChatBadge(tenant.slug, chatEnabled).data;
  const badges: Partial<Record<MemberSection, ChatBadgeLabel>> = { messages: chatBadgeLabel(badgeData), groups: groupsBadgeLabel(badgeData) };
  /** The badge on a section's link, for the sections that have one. */
  const badgeFor = (section: MemberSection) => {
    const badge = badges[section];
    return badge && badge.count > 0 ? badge : null;
  };
  // On a phone a section in the sheet has its badge there, so More says there's something inside.
  const moreBadges = overflow.map(badgeFor).filter((b): b is ChatBadgeLabel => b !== null);
  const moreCount = moreBadges.reduce((sum, b) => sum + b.count, 0);
  const { fullHeight, immersive } = useAppRouteHandle();

  const pollInterval = usePollInterval();
  const unread = useQuery({ queryKey: qk.unread(tenant.slug), queryFn: () => api.notifications.unreadCount(tenant.slug), refetchInterval: pollInterval });
  const unreadCount = unread.data?.count ?? 0;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const [moreOpen, setMoreOpen] = useState(false);
  // No bar link is active on these routes, so More shows where the member is. NavLink's own matching, so it can't disagree with the sheet.
  const onSheetRoute = [...overflowLinks.map((i) => i.to), `${base}/my-content`, `${base}/profile`].some((to) => matchPath({ path: to, end: false }, pathname));

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
    clsx(
      "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition duration-[var(--duration-fast)]",
      isActive ? "bg-primary/12 font-semibold text-primary shadow-[inset_3px_0_0_0_rgb(var(--c-primary))]" : "text-slate-500 hover:bg-slate-100/80 hover:text-slate-800",
    );
  const sheetRow = "flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium";
  const sheetLinkClass = ({ isActive }: { isActive: boolean }) => clsx(sheetRow, isActive ? "bg-primary/12 font-semibold text-primary" : "text-slate-700 hover:bg-slate-100");

  return (
    // A full-height screen scrolls inside itself, so the page around it is exactly the window.
    <div className={clsx("bg-[var(--surface-page)]", fullHeight ? "flex h-dvh flex-col overflow-hidden" : "min-h-full")}>
      <header className={clsx("sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md", immersive && "max-md:hidden")}>
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <NavLink to={homePath(tenant.slug, tenant.settings.features)} className="flex min-w-0 items-center gap-2">
            <Avatar name={tenant.shortName ?? tenant.name} src={tenant.logoUrl} size="sm" />
            <span className="font-display truncate text-[15px] font-semibold text-slate-900">{tenant.shortName ?? tenant.name}</span>
          </NavLink>
          <div className="ml-auto flex items-center gap-1">
            {isTenantAdmin && (
              <NavLink to={`/t/${tenant.slug}/admin`} className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:block">
                Admin
              </NavLink>
            )}
            <NavLink to={`${base}/notifications`} className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}>
              <IconBell size={20} />
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

      <div className={clsx("mx-auto flex w-full max-w-6xl gap-6", fullHeight ? "min-h-0 flex-1 md:px-4 md:py-6" : "px-4 py-6")}>
        <aside className={clsx("hidden w-56 shrink-0 md:block", fullHeight && "overflow-y-auto")}>
          <nav className="space-y-1.5" aria-label="Main">
            {sections.map((i) => {
              const badge = badgeFor(i.section);
              return (
                <NavLink key={i.to} to={i.to} className={linkClass} aria-label={badge?.label}>
                  <NavLabel icon={i.icon} label={i.label} />
                  {badge && <NavBadge count={badge.count} className="ml-auto" />}
                </NavLink>
              );
            })}
            {sections.length > 0 && <div className="my-3 border-t border-slate-200" />}
            <NavLink to={`${base}/my-content`} className={linkClass}>
              <NavLabel icon="posts" label="My posts" />
            </NavLink>
            <NavLink to={`${base}/profile`} className={linkClass}>
              <NavLabel icon="profile" label="My profile" />
            </NavLink>
            {isTenantAdmin && (
              <NavLink to={`/t/${tenant.slug}/admin`} className={linkClass}>
                <NavLabel icon="admin" label="Admin console" />
              </NavLink>
            )}
            <NavLink to="/?switch=1" className={linkClass({ isActive: false })}>
              <NavLabel icon="switch" label="Switch institution" />
            </NavLink>
            <button type="button" className={clsx(linkClass({ isActive: false }), "w-full text-left")} onClick={() => void signOut()}>
              <NavLabel icon="signOut" label="Sign out" />
            </button>
          </nav>
        </aside>
        <main className={clsx("min-w-0 flex-1", fullHeight ? clsx("flex min-h-0 flex-col", !immersive && "max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]") : "pb-20 md:pb-0")}>
          <Outlet />
        </main>
      </div>

      <nav aria-label="Main" className={clsx("fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200/80 bg-white/95 backdrop-blur-md md:hidden", immersive && "hidden")} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {barLinks.map((i) => {
          const badge = badgeFor(i.section);
          return (
            <NavLink key={i.to} to={i.to} aria-label={badge?.label} className={({ isActive }) => clsx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", isActive ? "text-primary" : "text-slate-500")}>
              <span className="relative" aria-hidden>
                <NavIcon name={i.icon} size={20} />
                {badge && <NavBadge count={badge.count} className="absolute -right-3 -top-1.5" />}
              </span>
              {i.label}
            </NavLink>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-current={onSheetRoute ? "true" : undefined}
          aria-label={moreCount > 0 ? `More, ${moreBadges.map((b) => b.label).join(", ")}` : undefined}
          className={clsx("flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium", moreOpen || onSheetRoute ? "text-primary" : "text-slate-500")}
        >
          <span className="relative" aria-hidden>
            <NavIcon name="more" size={20} />
            {moreCount > 0 && <NavBadge count={moreCount} className="absolute -right-3 -top-1.5" />}
          </span>
          More
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title={tenant.shortName ?? tenant.name}>
        {/* Following any link in the sheet closes it. */}
        <div className="space-y-1" onClick={(e) => (e.target as HTMLElement).closest("a") && setMoreOpen(false)}>
          {overflowLinks.map((i) => {
            const badge = badgeFor(i.section);
            return (
              <NavLink key={i.to} to={i.to} className={sheetLinkClass} aria-label={badge?.label}>
                <NavLabel icon={i.icon} label={i.label} />
                {badge && <NavBadge count={badge.count} className="ml-auto" />}
              </NavLink>
            );
          })}
          <NavLink to={`${base}/my-content`} className={sheetLinkClass}>
            <NavLabel icon="posts" label="My posts" />
          </NavLink>
          <NavLink to={`${base}/profile`} className={sheetLinkClass}>
            <NavLabel icon="profile" label="My profile" />
          </NavLink>
          {isTenantAdmin && (
            <NavLink to={`/t/${tenant.slug}/admin`} className={sheetLinkClass}>
              <NavLabel icon="admin" label="Admin console" />
            </NavLink>
          )}
          <NavLink to="/?switch=1" className={sheetLinkClass({ isActive: false })}>
            <NavLabel icon="switch" label="Switch institution" />
          </NavLink>
          <button type="button" className={clsx(sheetRow, "w-full text-left text-red-600 hover:bg-slate-100")} onClick={() => void signOut()}>
            <NavLabel icon="signOut" label="Sign out" />
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** A count on a navigation link. Hidden from screen readers, because the link's own name says it. */
function NavBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span aria-hidden className={clsx("rounded-full bg-red-500 px-1.5 text-[10px] font-semibold leading-4 text-white", className)}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
