import { avatarTone, brandAvatarTone, type ToneName } from "@illuminize/shared";
import clsx from "clsx";
import { forwardRef, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { IconAlert, IconCheck, IconChevronRight, IconInfo, IconProfile } from "@/components/icons";
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
// A field is white on a white card, so its edge is all that shows where it is: the faint grey, 3:1 on white (WCAG
// 1.4.11). Focused, the edge is the ink, which shows in any institution colour. Invalid, it is the danger edge, which
// Tailwind writes after slate-400 (the two set one property, in name order), so it wins; border-red-400 never did.
const controlClass =
  "w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-ink focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-slate-50";
const invalidControlClass = "border-tone-danger-edge";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={clsx(controlClass, invalid && [invalidControlClass, "focus:ring-red-200"], className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(controlClass, "min-h-24", invalid && invalidControlClass, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(controlClass, invalid && invalidControlClass, className)} {...rest}>
      {children}
    </select>
  );
});

type ChoiceInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { type: "checkbox" | "radio" };

/**
 * A checkbox's box or a radio's ring, drawn alike in any institution colour: a meta-grey edge (3:1) when clear; chosen,
 * the box filled with the brand's ink holding a white tick, or an ink ring and dot. It stays a real input, so labels,
 * forms and Playwright's check() work as ever, and forced colours (Windows High Contrast) get the native control back.
 * `className` goes on the 16px wrapper (a margin, a stacking order); everything else on the input.
 */
export const ChoiceInput = forwardRef<HTMLInputElement, ChoiceInputProps>(function ChoiceInput({ type, className, ...rest }, ref) {
  const radio = type === "radio";
  const overlay = "pointer-events-none col-start-1 row-start-1 hidden peer-checked:block peer-disabled:opacity-50 forced-colors:hidden!";
  return (
    <span className={clsx("relative inline-grid size-4 shrink-0 place-items-center", className)}>
      <input
        ref={ref}
        type={type}
        className={clsx(
          "peer col-start-1 row-start-1 size-4 appearance-none border-2 border-slate-500 bg-white transition-colors checked:border-primary-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ink disabled:opacity-50 motion-reduce:transition-none forced-colors:appearance-auto",
          radio ? "rounded-full" : "rounded checked:bg-primary-ink",
        )}
        {...rest}
      />
      {radio ? <span aria-hidden className={clsx(overlay, "size-2 rounded-full bg-primary-ink")} /> : <IconCheck size={12} strokeWidth={3} className={clsx(overlay, "text-white")} />}
    </span>
  );
});

/**
 * A checkbox with its label beside it, the box at the label's first line: a bare row, with no wash or ring when ticked.
 * A disabled one fades its box and draws its label in the meta grey, from the input itself (so register() works too):
 * callers don't fade the row. A row that has to be a 44px target passes `min-h-11 py-3`, which keeps a one-line label
 * centred.
 */
export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }>(function Checkbox({ label, className, ...rest }, ref) {
  return (
    <label className={clsx("flex cursor-pointer items-start gap-2 text-sm text-slate-700 has-disabled:cursor-not-allowed has-disabled:text-slate-500", className)}>
      <ChoiceInput ref={ref} {...rest} type="checkbox" className="mt-0.5" />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );
});

/**
 * One choice as a 44px tile: a checkbox or radio and its label. Chosen, it takes the wash, a thin ring and the ink box,
 * which show it's chosen, and the label stays slate-900. Disabled, ticked or not, it is the plain grey tile with a
 * faded box and a meta-grey label, as the phone's is. It draws its state from `checked` and `disabled`, so it is for
 * controlled inputs.
 *
 * `fit` sizes the tile to its label, as a chip in a wrapping row (`flex flex-wrap`), never wider than the row: tiles wrap
 * to the next line before they shrink, so a label wraps (at its spaces, and inside a word only as a last resort) only
 * when its tile alone is wider than the row. Its padding and box are in rem and grow with the text, as the page's
 * margins do, so at twice the text size a phone-width row can be narrower than a long name's tile.
 */
export const Choice = forwardRef<HTMLInputElement, ChoiceInputProps & { label: ReactNode; fit?: boolean }>(function Choice({ type, label, fit = false, className, ...rest }, ref) {
  return (
    <label
      className={clsx(
        "min-h-11 min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors motion-reduce:transition-none",
        fit ? "inline-flex max-w-full" : "flex w-full",
        rest.disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-500"
          : rest.checked
            ? "cursor-pointer border-primary-ring bg-primary-wash text-slate-900"
            : "cursor-pointer border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50",
        className,
      )}
    >
      <ChoiceInput ref={ref} type={type} {...rest} />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );
});

/**
 * A chip of several that can be chosen together (Open to, the institution's multiple-choice questions): a 44px button
 * whose state is in aria-pressed. On, it takes the wash, a thin ring and the ink, with a tick before its label, so it
 * isn't told by colour alone, as the phone's `Chip check` is; hover goes on the off state only. In a wrapping row (`flex
 * flex-wrap`) it is never wider than the row: chips wrap to the next line first, and a label wraps inside its chip (at
 * its spaces, and inside a word only as a last resort) only when the chip alone is wider than the row.
 */
export const ToggleChip = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed"> & { on: boolean }>(function ToggleChip(
  { on, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={on}
      className={clsx(
        "inline-flex min-h-11 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-ink motion-reduce:transition-none",
        on ? "border-primary-ring bg-primary-wash text-primary-ink" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50",
        className,
      )}
      {...rest}
    >
      {on && <IconCheck size={16} strokeWidth={2.5} />}
      <span className="min-w-0 break-words">{children}</span>
    </button>
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
      {required && <span className="text-tone-danger-ink"> *</span>}
    </>
  );
  const caption = (
    <span id={id} className={captionClass}>
      {captionText}
    </span>
  );
  const descId = htmlFor ? `${htmlFor}-desc` : undefined;
  const footer = error ? (
    <span id={descId} className="mt-1 block text-xs text-tone-danger-ink" role="alert">
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
  1: "border bg-[var(--surface-1)] shadow-[var(--shadow-1)]",
  2: "border bg-[var(--surface-2)] shadow-[var(--shadow-2)]",
};
const cardBorderClass: Record<CardElevation, string> = { 1: "border-[var(--border-subtle)]", 2: "border-[var(--border-strong)]" };

/**
 * A card's surface at `elevation`. A highlighted one keeps it, white, and swaps its grey border for the brand's edge
 * rather than adding a second border colour, whose winner would be left to the CSS order.
 */
function cardClass(elevation: CardElevation, highlight = false) {
  return clsx(cardElevationClass[elevation], highlight ? "border-primary-edge" : cardBorderClass[elevation]);
}

/**
 * `highlight` frames the card in the brand's edge (a pinned post), 3:1 against the white card for any brand. On a
 * member's tinted page it can fall a little under 3:1 against the page outside, so it only adds to words that say the
 * same (the post's Pinned line), never stands for them.
 */
export function Card({ className, children, as: Tag = "div", elevation = 1, highlight = false }: { className?: string; children: ReactNode; as?: "div" | "section" | "article"; elevation?: CardElevation; highlight?: boolean }) {
  return <Tag className={clsx("rounded-xl", cardClass(elevation, highlight), className)}>{children}</Tag>;
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

type Tone = ToneName | "primary";
/** The shared status tones (STATUS_TONES), so a tag looks the same as on the phone; the brand's is its tint, edge and ink. */
const toneClass: Record<Tone, string> = {
  neutral: "border-tone-neutral-edge bg-tone-neutral-fill text-tone-neutral-ink",
  success: "border-tone-success-edge bg-tone-success-fill text-tone-success-ink",
  warning: "border-tone-warning-edge bg-tone-warning-fill text-tone-warning-ink",
  danger: "border-tone-danger-edge bg-tone-danger-fill text-tone-danger-ink",
  info: "border-tone-info-edge bg-tone-info-fill text-tone-info-ink",
  primary: "border-primary-edge bg-primary/10 text-primary-ink",
};
/** A tag. Its 1px edge keeps its shape where the fill doesn't show (forced colours), and takes a pixel off the padding. */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center rounded-full border px-[7px] py-px text-xs font-medium", toneClass[tone], className)}>{children}</span>;
}

/**
 * A note in one of two shared tones, never the brand's: `info` (sky, IconInfo) for something worth knowing before acting,
 * `warning` (amber, IconAlert) for what went wrong or needs waiting for. It isn't live: a warning that appears later goes
 * inside a region that's always mounted with role="status", so screen readers hear it. `data-tone` is for e2e.
 */
export function Notice({ tone, icon, id, className, children }: { tone: "info" | "warning"; icon?: ReactElement; id?: string; className?: string; children: ReactNode }) {
  return (
    <div id={id} data-tone={tone} className={clsx("flex items-start gap-2 rounded-lg px-3 py-2 text-sm", tone === "info" ? "bg-tone-info-fill text-tone-info-ink" : "bg-tone-warning-fill text-tone-warning-ink", className)}>
      <span aria-hidden className="mt-0.5 flex shrink-0">
        {icon ?? (tone === "info" ? <IconInfo size={16} /> : <IconAlert size={16} />)}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const s = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-10 w-10" : "h-6 w-6";
  return <span role="status" className={clsx("inline-block animate-spin rounded-full border-2 border-current border-t-transparent text-primary", s, className)} aria-label="Loading" />;
}

/**
 * A centred spinner, only where there's no page yet to outline (the guards, sign-in); a list's first load draws
 * ListSkeleton, and a detail or form page PageSkeleton under its header and Back.
 */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500" role="status" aria-live="polite">
      <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" aria-hidden /> <span className="text-sm">{label}</span>
    </div>
  );
}

export { ListSkeleton, PageSkeleton, Skeleton, SkeletonLines, SkeletonStatus } from "./Skeleton";

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

/**
 * A photo, or initials in its place. A member's initials pass `toneKey`, their membership id, for a colour of their own
 * (avatarTone) that is the same on every screen. A page no institution's theme colours passes the institution's
 * `brandColor` (each one's in a list of several, the invited one's on the invitation page). Otherwise (this institution,
 * a business, a group) they are the brand's ink on its solid tint.
 */
export function Avatar({
  name,
  src,
  size = "md",
  className,
  toneKey,
  brandColor,
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  toneKey?: string | null;
  brandColor?: string | null;
}) {
  const s = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-14 w-14 text-base", xl: "h-24 w-24 text-2xl" }[size];
  const iconSize = { sm: 16, md: 20, lg: 28, xl: 44 }[size];
  // The initials (or, with no name yet, a person icon) show while the photo loads and whenever it won't (deleted,
  // offline, blocked). Remembering which src loaded or failed, rather than flags, makes a new photo start over.
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const tone = useMemo(() => (toneKey ? avatarTone(toneKey) : brandColor ? brandAvatarTone(brandColor) : null), [toneKey, brandColor]);
  const photo = src && src !== failed ? src : null;
  const shown = !!photo && loaded === photo;
  const letters = initials(name);
  return (
    // Once the photo is in, the tint goes, so a logo with see-through parts looks as it would on its own. A tone is
    // known only at run time, so it's an inline style.
    <span
      className={clsx("relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold", !tone && "text-primary-ink", !tone && !shown && "bg-primary-tint", s, className)}
      style={tone ? { color: tone.fg, backgroundColor: shown ? undefined : tone.bg } : undefined}
    >
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

/** `error`: what went wrong with the page it asked for (useInfiniteList's `nextPageError`), said above it; pressing it again tries again. */
export function LoadMore({ hasNextPage, isFetchingNextPage, fetchNextPage, error }: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => void; error?: unknown }) {
  if (!hasNextPage) return null;
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      {error != null && (
        <div role="alert" className="w-full">
          <ErrorBox error={error} />
        </div>
      )}
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
    <div className={clsx("rounded-xl p-4", attention ? "border border-amber-300 bg-amber-50 shadow-[var(--shadow-1)]" : cardClass(1))}>
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
            t.tone === "success" ? "bg-tone-success-solid" : t.tone === "error" ? "bg-tone-danger-solid" : "bg-slate-800",
          )}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
