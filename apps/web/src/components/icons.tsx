import clsx from "clsx";
import type { ReactElement, ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number; title?: string };

function Svg({ size = 20, className, title, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx("shrink-0", className)}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IconFeed(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </Svg>
  );
}
export function IconMessages(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z" />
    </Svg>
  );
}
export function IconJobs(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Svg>
  );
}
export function IconDirectory(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 19a6 6 0 0 1 12 0M14 19a4.5 4.5 0 0 1 7 0" />
    </Svg>
  );
}
export function IconEvents(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </Svg>
  );
}
export function IconGroups(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 19a6 6 0 0 1 12 0M14 19a4.5 4.5 0 0 1 7 0" />
    </Svg>
  );
}
export function IconMentors(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="7" r="3" />
      <path d="M5 20a7 7 0 0 1 14 0M12 10v3M10 14h4" />
    </Svg>
  );
}
export function IconBusinesses(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20V9l8-5 8 5v11" />
      <path d="M9 20v-6h6v6" />
    </Svg>
  );
}
export function IconFunding(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3v18M16 7H9.5a2.5 2.5 0 0 0 0 5H14a2.5 2.5 0 0 1 0 5H7" />
    </Svg>
  );
}
export function IconPosts(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Svg>
  );
}
export function IconProfile(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  );
}
export function IconAdmin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3 4 7v5c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V7z" />
    </Svg>
  );
}
export function IconSwitch(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7" />
    </Svg>
  );
}
export function IconSignOut(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 17l5-5-5-5M15 12H3M21 21V3" />
    </Svg>
  );
}
export function IconMore(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}
export function IconBell(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Svg>
  );
}
export function IconImage(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m21 16-4.5-4.5L9 19" />
    </Svg>
  );
}
export function IconPoll(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 20V10M12 20V4M18 20v-7" />
    </Svg>
  );
}
export function IconAnnounce(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 11v2a2 2 0 0 0 2 2h2l6 4V5L7 9H5a2 2 0 0 0-2 2z" />
      <path d="M16 9.5a4 4 0 0 1 0 5" />
    </Svg>
  );
}
export function IconPin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 17v5M9 3h6l-1 7h3l-5 6-5-6h3z" />
    </Svg>
  );
}
export function IconComment(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M21 14a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z" />
    </Svg>
  );
}
export function IconCake(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 4v3M8 8h8v3H8zM5 11h14v9H5z" />
      <path d="M5 15h14" />
    </Svg>
  );
}
export function IconSpark(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
    </Svg>
  );
}
export function IconDashboard(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
    </Svg>
  );
}
export function IconAnalytics(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" />
    </Svg>
  );
}
export function IconFlag(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 21V4M5 4h10l-1.5 4L15 12H5" />
    </Svg>
  );
}
export function IconMail(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 7 9-7" />
    </Svg>
  );
}
export function IconFields(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  );
}
export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}
export function IconAudit(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Svg>
  );
}
export function IconLike(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 2 2v3h5.2a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17 20H7" />
    </Svg>
  );
}
export function IconLove(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
    </Svg>
  );
}
export function IconCelebrate(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 22 4 12l6 2 2-8 2 8 6-2-4 10z" />
    </Svg>
  );
}
export function IconInsight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 18h6M10 21h4M8 14a5 5 0 1 1 8 0c-.8.9-1.5 1.6-1.5 3h-5c0-1.4-.7-2.1-1.5-3z" />
    </Svg>
  );
}
export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m5 12 5 5L20 7" />
    </Svg>
  );
}
export function IconClose(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export type NavIconName =
  | "feed"
  | "messages"
  | "jobs"
  | "directory"
  | "events"
  | "groups"
  | "mentors"
  | "businesses"
  | "funding"
  | "posts"
  | "profile"
  | "admin"
  | "switch"
  | "signOut"
  | "more"
  | "bell";

const NAV: Record<NavIconName, (p: IconProps) => ReactElement> = {
  feed: IconFeed,
  messages: IconMessages,
  jobs: IconJobs,
  directory: IconDirectory,
  events: IconEvents,
  groups: IconGroups,
  mentors: IconMentors,
  businesses: IconBusinesses,
  funding: IconFunding,
  posts: IconPosts,
  profile: IconProfile,
  admin: IconAdmin,
  switch: IconSwitch,
  signOut: IconSignOut,
  more: IconMore,
  bell: IconBell,
};

export function NavIcon({ name, ...p }: IconProps & { name: NavIconName }) {
  const Comp = NAV[name];
  return <Comp {...p} />;
}
