import clsx from "clsx";
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { IconChevronRight, IconProfile } from "@/components/icons";
import { initials } from "@/lib/format";

/* ---------- Button ---------- */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const variantClass: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:opacity-90 shadow-sm",
  secondary: "bg-slate-900 text-white hover:bg-slate-800",
  outline: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-700",
};
const sizeClass: Record<Size, string> = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base" };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
        variantClass[variant],
        sizeClass[size],
        block && "w-full",
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner size="sm" className="text-current" />}
      {children}
    </button>
  );
});

export function LinkButton({ to, state, variant = "primary", size = "md", className, children }: { to: string; state?: unknown; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link to={to} state={state} className={clsx("inline-flex items-center justify-center gap-2 rounded-lg font-medium transition", variantClass[variant], sizeClass[size], className)}>
      {children}
    </Link>
  );
}

/* ---------- Form controls ---------- */
const controlClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={clsx(controlClass, invalid && "border-red-400 focus:ring-red-200", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(controlClass, "min-h-24", invalid && "border-red-400", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(controlClass, invalid && "border-red-400", className)} {...rest}>
      {children}
    </select>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }>(function Checkbox({ label, className, ...rest }, ref) {
  return (
    <label className={clsx("flex cursor-pointer items-center gap-2 text-sm text-slate-700", className)}>
      <input ref={ref} type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-primary" {...rest} />
      {label}
    </label>
  );
});

/**
 * A label + control + error/hint stack. Wrap a single input (the default) so clicking the label focuses it. Pass
 * `group` when the children are several controls or buttons (colour pickers, image uploaders): a wrapping <label>
 * would forward clicks on the caption to the first button inside. Pass `htmlFor` for one input with buttons beside it
 * (a chip input): the caption labels that input alone, and the error or hint has the id `${htmlFor}-desc` for its
 * aria-describedby.
 */
export function FormField({
  label,
  error,
  hint,
  children,
  required,
  group,
  htmlFor,
}: {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  required?: boolean;
  group?: boolean;
  htmlFor?: string;
}) {
  const id = useId();
  const captionClass = "mb-1 block text-sm font-medium text-slate-700";
  const captionText = (
    <>
      {label}
      {required && <span className="text-red-500"> *</span>}
    </>
  );
  const caption = (
    <span id={id} className={captionClass}>
      {captionText}
    </span>
  );
  const descId = htmlFor ? `${htmlFor}-desc` : undefined;
  const footer = error ? (
    <span id={descId} className="mt-1 block text-xs text-red-600" role="alert">
      {error}
    </span>
  ) : hint ? (
    <span id={descId} className="mt-1 block text-xs text-slate-500">
      {hint}
    </span>
  ) : null;
  if (htmlFor)
    return (
      <div className="block">
        <label htmlFor={htmlFor} id={id} className={captionClass}>
          {captionText}
        </label>
        {children}
        {footer}
      </div>
    );
  if (group)
    return (
      <div role="group" aria-labelledby={id} className="block">
        {caption}
        {children}
        {footer}
      </div>
    );
  return (
    <label className="block">
      {caption}
      {children}
      {footer}
    </label>
  );
}

/* ---------- Layout bits ---------- */
type CardElevation = 1 | 2;

const cardElevationClass: Record<CardElevation, string> = {
  1: "border border-[var(--border-subtle)] bg-[var(--surface-1)] shadow-[var(--shadow-1)]",
  2: "border border-[var(--border-strong)] bg-[var(--surface-2)] shadow-[var(--shadow-2)]",
};

export function Card({ className, children, as: Tag = "div", elevation = 1 }: { className?: string; children: ReactNode; as?: "div" | "section" | "article"; elevation?: CardElevation }) {
  return <Tag className={clsx("rounded-xl", cardElevationClass[elevation], className)}>{children}</Tag>;
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="font-display text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm leading-snug text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";
const toneClass: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-sky-100 text-sky-800",
  primary: "bg-primary/10 text-primary-ink",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", toneClass[tone], className)}>{children}</span>;
}

export function Spinner({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const s = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-10 w-10" : "h-6 w-6";
  return <span role="status" className={clsx("inline-block animate-spin rounded-full border-2 border-current border-t-transparent text-primary", s, className)} aria-label="Loading" />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500" role="status" aria-live="polite">
      <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" aria-hidden /> <span className="text-sm">{label}</span>
    </div>
  );
}

/**
 * The round badge an empty state or a chat notice draws its icon in, hidden from screen readers: the brand's wash, with
 * the icon in its ink, which reads on it at 3:1 whatever colour the institution chose. It sets the icon's size and colour
 * (its rules reach the SVG, so they beat a class on it), so callers pass the bare icon, such as `<IconMail />`.
 */
export function EmptyIcon({ icon, size = "regular", className }: { icon: ReactElement; size?: "regular" | "small"; className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-full bg-primary-wash text-primary-ink [&_svg]:text-primary-ink",
        size === "small" ? "size-10 [&_svg]:size-5" : "size-14 [&_svg]:size-7",
        className,
      )}
    >
      {icon}
    </div>
  );
}

const textOf = (node: ReactNode) => (typeof node === "string" || typeof node === "number" ? String(node) : "");

/**
 * A live empty state's words in a status line. They go in a moment after it mounts, because a live region that arrives
 * already filled is often not read, and come out again so the hidden copy doesn't linger beside the visible one.
 */
function LiveText({ text }: { text: string }) {
  const [said, setSaid] = useState("");
  useEffect(() => {
    const fill = setTimeout(() => setSaid(text), 150);
    const clear = setTimeout(() => setSaid(""), 5150);
    return () => {
      clearTimeout(fill);
      clearTimeout(clear);
    };
  }, [text]);
  return (
    <p role="status" className="sr-only">
      {said}
    </p>
  );
}

/**
 * What a list or a page says when it has nothing to show. `icon` is an SVG from `components/icons.tsx`, passed bare
 * (EmptyIcon draws it). `action` holds its ways on, links or buttons, centred and at least 44px tall: the main way on
 * first, as primary; a second way, a way back or one that clears a search or a filter may be outline. `inline` is for
 * inside a card or a list: no frame, and a smaller badge. `live` is for search and filter
 * results: a status line reads out the title and the description (when they're text), so it repeats them in hidden text.
 * The h3 stays a direct child of the box, which is how the e2e scripts find it.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  inline = false,
  live = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactElement;
  inline?: boolean;
  live?: boolean;
}) {
  const spoken = [textOf(title), textOf(description)].filter(Boolean).map((s) => (/[.!?…]$/.test(s) ? s : `${s}.`));
  return (
    <div className={clsx("flex flex-col items-center justify-center text-center", inline ? "px-4 py-6" : "rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10")}>
      {icon && <EmptyIcon icon={icon} size={inline ? "small" : "regular"} className={inline ? "mb-2" : "mb-3"} />}
      <h3 className={clsx("font-semibold text-slate-900", inline ? "text-sm" : "text-base")}>{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-balance text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2 [&>a]:min-h-11 [&>button]:min-h-11">{action}</div>}
      {live && <LiveText text={spoken.join(" ")} />}
    </div>
  );
}

export function ErrorBox({ error, className }: { error: unknown; className?: string }) {
  const message = error instanceof Error ? error.message : String(error ?? "Something went wrong");
  return <div className={clsx("rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700", className)}>{message}</div>;
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ value: T; label: ReactNode; count?: number }>; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    // max-w-full: a strip sized to its tabs (w-fit) scrolls inside itself on a phone rather than widening the page.
    <div className={clsx("flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1", className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={clsx(
            "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition",
            t.value === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 text-xs text-slate-700">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, src, size = "md", className }: { name: string; src?: string | null; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const s = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-base", xl: "h-24 w-24 text-2xl" }[size];
  const iconSize = { sm: 16, md: 20, lg: 28, xl: 44 }[size];
  // The initials (or, with no name yet, a person icon) show while the photo loads and whenever it won't (deleted,
  // offline, blocked). Remembering which src loaded or failed, rather than flags, makes a new photo start over.
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const photo = src && src !== failed ? src : null;
  const shown = !!photo && loaded === photo;
  const letters = initials(name);
  return (
    // Once the photo is in, the tint goes, so a logo with see-through parts looks as it would on its own.
    <span className={clsx("relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-primary", !shown && "bg-primary/15", s, className)}>
      {!shown && (
        <span aria-hidden={photo ? true : undefined} className="flex items-center justify-center">
          {letters || <IconProfile size={iconSize} />}
        </span>
      )}
      {photo && <img src={photo} alt={name} onLoad={() => setLoaded(photo)} onError={() => setFailed(photo)} className="absolute inset-0 h-full w-full object-cover" />}
    </span>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    // Focus the first form control (or the panel) so keyboard and screen-reader users land inside the dialog.
    const first = panel.current?.querySelector<HTMLElement>("input, textarea, select, [data-autofocus]");
    (first ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl outline-none sm:max-w-lg sm:rounded-2xl"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          {/* A 44px target; the negative margins keep the header as tall as its title. */}
          <button type="button" onClick={onClose} className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-primary" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function LoadMore({ hasNextPage, isFetchingNextPage, fetchNextPage }: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => void }) {
  if (!hasNextPage) return null;
  return (
    <div className="flex justify-center py-4">
      <Button variant="outline" onClick={fetchNextPage} loading={isFetchingNextPage}>
        Load more
      </Button>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between py-3 text-sm text-slate-600">
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/**
 * A figure on a card. `attention` draws work waiting in amber, as the phone app's console tiles do; `linked` adds the
 * chevron of a tile that opens its section (the caller wraps it in the link).
 */
export function Stat({ label, value, hint, attention, linked }: { label: ReactNode; value: ReactNode; hint?: ReactNode; attention?: boolean; linked?: boolean }) {
  return (
    // Not a Card with an amber className: two border and background colours would leave the winner to the CSS order.
    <div className={clsx("rounded-xl p-4", attention ? "border border-amber-300 bg-amber-50 shadow-[var(--shadow-1)]" : cardElevationClass[1])}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        {linked && <IconChevronRight size={16} className="text-slate-400" />}
      </div>
      <div className={clsx("mt-1 text-2xl font-semibold", attention ? "text-amber-800" : "text-slate-900")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Toaster() {
  // Rendered once at the app root; consumes the toast store lazily to avoid an import cycle.
  return <ToastList />;
}

import { useToastStore } from "@/stores/uiStore";
function ToastList() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={clsx(
            "pointer-events-auto rounded-lg px-4 py-2 text-sm text-white shadow-lg",
            t.tone === "success" ? "bg-emerald-600" : t.tone === "error" ? "bg-red-600" : "bg-slate-800",
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
