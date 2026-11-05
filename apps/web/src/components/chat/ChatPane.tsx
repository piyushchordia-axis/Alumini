import type { ChatMemberDto } from "@illuminize/shared";
import clsx from "clsx";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Avatar } from "@/components/ui";
import { useVisualViewport } from "@/hooks/useVisualViewport";

/**
 * The frame of a thread. On phones it takes the whole visible screen, sized to the part the keyboard leaves, because a
 * mobile browser opens the keyboard over the page and would hide the composer. On wider screens it sits in its pane.
 */
export function ChatPane({ children }: { children: (keyboardOpen: boolean) => ReactNode }) {
  const viewport = useVisualViewport();
  const style = viewport ? ({ "--chat-height": `${viewport.height}px`, "--chat-top": `${viewport.offsetTop}px` } as CSSProperties) : undefined;
  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-white max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:z-30 max-md:h-[var(--chat-height,100dvh)] max-md:translate-y-[var(--chat-top,0px)]"
      style={style}
    >
      {children(!!viewport?.keyboardOpen)}
    </div>
  );
}

/**
 * In place of a thread that can't be shown: says why and offers a way on, as the phone app's ChatNotice does. `icon` is an
 * SVG from `components/icons.tsx`, drawn in slate-400 and hidden from screen readers; `children` are the ways on.
 */
export function ChatNotice({ icon, title, text, children }: { icon?: ReactElement; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      {icon && (
        <div aria-hidden className="mb-1 text-slate-400">
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-slate-800">{title}</p>
      {text && <p className="max-w-sm text-balance text-sm text-slate-500">{text}</p>}
      {children && <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** A thread's title bar: back to the inbox on phones, who it's with, and whatever actions the screen has. No `member` means no avatar, as while loading. */
export function ChatPaneHeader({ backTo, title, member, profileHref, subtitle, actions }: { backTo: string; title: string; member?: ChatMemberDto | null; profileHref?: string | null; subtitle?: ReactNode; actions?: ReactNode }) {
  const who = (
    <>
      {member !== undefined && <Avatar name={title} src={member?.avatarUrl} size="sm" />}
      <span className="min-w-0">
        <span className="block truncate text-base font-semibold text-slate-900">{title}</span>
        {subtitle && <span className="block truncate text-xs text-slate-500">{subtitle}</span>}
      </span>
    </>
  );
  return (
    <header className="flex items-center gap-1 border-b border-slate-200 px-1 py-1.5 max-md:pt-[max(0.375rem,env(safe-area-inset-top))] sm:px-3">
      <Link to={backTo} aria-label="Back to messages" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary md:hidden">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </Link>
      <h2 className="min-w-0 flex-1">
        {profileHref ? (
          <Link to={profileHref} className={clsx("flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-1 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary")}>
            {who}
          </Link>
        ) : (
          <span className="flex min-h-11 min-w-0 items-center gap-2 px-1">{who}</span>
        )}
      </h2>
      {actions}
    </header>
  );
}
