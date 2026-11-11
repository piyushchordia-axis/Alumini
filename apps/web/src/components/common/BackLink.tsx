import clsx from "clsx";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { IconChevronLeft } from "@/components/icons";

/**
 * The way back from a detail or form page, above its content. The page draws the same link while it loads, fails and
 * shows, so it's always the first thing there and focus never jumps when the content comes. 44px tall.
 */
export function BackLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={clsx("inline-flex min-h-11 items-center gap-1 text-sm text-slate-500 hover:text-slate-800 [overflow-wrap:anywhere]", className)}>
      <IconChevronLeft size={16} />
      {children}
    </Link>
  );
}
