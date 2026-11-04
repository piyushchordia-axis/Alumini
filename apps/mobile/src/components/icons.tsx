import type { ReactElement, ReactNode } from "react";
import type { ColorValue } from "react-native";
import { Circle, Path, Rect, Svg } from "react-native-svg";

type Props = { size?: number; color?: ColorValue };

function Base({ size = 20, children }: Props & { children: ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </Svg>
  );
}

const stroke = (color: ColorValue | undefined) => ({ stroke: (color as string) || "#0f172a", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const });

export function IconFeed({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M4 6h16M4 12h16M4 18h10" {...stroke(color)} />
    </Base>
  );
}
export function IconMessages({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M21 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z" {...stroke(color)} />
    </Base>
  );
}
export function IconJobs({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Rect x="3" y="7" width="18" height="13" rx="2" {...stroke(color)} />
      <Path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" {...stroke(color)} />
    </Base>
  );
}
export function IconDirectory({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Circle cx="9" cy="8" r="3" {...stroke(color)} />
      <Circle cx="17" cy="9" r="2.5" {...stroke(color)} />
      <Path d="M3 19a6 6 0 0 1 12 0M14 19a4.5 4.5 0 0 1 7 0" {...stroke(color)} />
    </Base>
  );
}
export function IconEvents({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Rect x="3" y="5" width="18" height="16" rx="2" {...stroke(color)} />
      <Path d="M8 3v4M16 3v4M3 10h18" {...stroke(color)} />
    </Base>
  );
}
export function IconGroups({ size = 20, color }: Props) {
  return <IconDirectory size={size} color={color} />;
}
export function IconMentors({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Circle cx="12" cy="7" r="3" {...stroke(color)} />
      <Path d="M5 20a7 7 0 0 1 14 0M12 10v3M10 14h4" {...stroke(color)} />
    </Base>
  );
}
export function IconBusinesses({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M4 20V9l8-5 8 5v11" {...stroke(color)} />
      <Path d="M9 20v-6h6v6" {...stroke(color)} />
    </Base>
  );
}
export function IconFunding({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M12 3v18M16 7H9.5a2.5 2.5 0 0 0 0 5H14a2.5 2.5 0 0 1 0 5H7" {...stroke(color)} />
    </Base>
  );
}
export function IconPosts({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" {...stroke(color)} />
    </Base>
  );
}
export function IconProfile({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Circle cx="12" cy="8" r="3.5" {...stroke(color)} />
      <Path d="M5 20a7 7 0 0 1 14 0" {...stroke(color)} />
    </Base>
  );
}
export function IconCamera({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" {...stroke(color)} />
      <Circle cx="12" cy="13.5" r="3.5" {...stroke(color)} />
    </Base>
  );
}
export function IconLink({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" {...stroke(color)} />
      <Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" {...stroke(color)} />
    </Base>
  );
}
export function IconCode({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" {...stroke(color)} />
    </Base>
  );
}
export function IconAt({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Circle cx="12" cy="12" r="4" {...stroke(color)} />
      <Path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" {...stroke(color)} />
    </Base>
  );
}
export function IconChevronDown({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="m6 9 6 6 6-6" {...stroke(color)} />
    </Base>
  );
}
export function IconMore({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M4 7h16M4 12h16M4 17h16" {...stroke(color)} />
    </Base>
  );
}
export function IconSwitch({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7" {...stroke(color)} />
    </Base>
  );
}
export function IconSignOut({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M10 17l5-5-5-5M15 12H3M21 21V3" {...stroke(color)} />
    </Base>
  );
}
export function IconBell({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6" {...stroke(color)} />
      <Path d="M10 19a2 2 0 0 0 4 0" {...stroke(color)} />
    </Base>
  );
}
export function IconComment({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M21 14a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z" {...stroke(color)} />
    </Base>
  );
}
export function IconLike({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 2 2v3h5.2a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17 20H7" {...stroke(color)} />
    </Base>
  );
}
export function IconLove({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" {...stroke(color)} />
    </Base>
  );
}
export function IconCelebrate({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M8 22 4 12l6 2 2-8 2 8 6-2-4 10z" {...stroke(color)} />
    </Base>
  );
}
export function IconInsight({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M9 18h6M10 21h4M8 14a5 5 0 1 1 8 0c-.8.9-1.5 1.6-1.5 3h-5c0-1.4-.7-2.1-1.5-3z" {...stroke(color)} />
    </Base>
  );
}
export function IconAnnounce({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M3 11v2a2 2 0 0 0 2 2h2l6 4V5L7 9H5a2 2 0 0 0-2 2z" {...stroke(color)} />
      <Path d="M16 9.5a4 4 0 0 1 0 5" {...stroke(color)} />
    </Base>
  );
}
export function IconPin({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M12 17v5M9 3h6l-1 7h3l-5 6-5-6h3z" {...stroke(color)} />
    </Base>
  );
}
export function IconCake({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M12 4v3M8 8h8v3H8zM5 11h14v9H5zM5 15h14" {...stroke(color)} />
    </Base>
  );
}
export function IconSpark({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" {...stroke(color)} />
    </Base>
  );
}

export function IconGraduationCap({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M2 9l10-5 10 5-10 5z" {...stroke(color)} />
      <Path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6" {...stroke(color)} />
    </Base>
  );
}
export function IconGlobe({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Circle cx="12" cy="12" r="9" {...stroke(color)} />
      <Path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" {...stroke(color)} />
    </Base>
  );
}
export function IconClose({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="M6 6l12 12M18 6 6 18" {...stroke(color)} />
    </Base>
  );
}
export function IconCheck({ size = 20, color }: Props) {
  return (
    <Base size={size} color={color}>
      <Path d="m5 12 5 5L20 7" {...stroke(color)} />
    </Base>
  );
}

export type NavIconName = "feed" | "messages" | "jobs" | "directory" | "events" | "groups" | "mentors" | "businesses" | "funding" | "posts" | "profile" | "more" | "switch" | "signOut" | "bell";

const NAV: Record<NavIconName, (p: Props) => ReactElement> = {
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
  more: IconMore,
  switch: IconSwitch,
  signOut: IconSignOut,
  bell: IconBell,
};

export function NavIcon({ name, ...p }: Props & { name: NavIconName }) {
  const Comp = NAV[name];
  return <Comp {...p} />;
}
