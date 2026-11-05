import { formatPhone } from "@illuminize/shared";
import clsx from "clsx";
import { IconPhone } from "@/components/icons";

/**
 * "Signed in as +91 98765 43210", then "Use a different number", on registration's first step and on the landing page of
 * an institution they haven't joined: the number the code went to, so a wrong one is noticed before joining with it. On
 * a narrow screen the button wraps under the number, whole.
 */
export function SignedInAs({ phone, onUseDifferentNumber, className }: { phone: string | null | undefined; onUseDifferentNumber: () => void; className?: string }) {
  return (
    <div className={clsx("flex flex-wrap items-center gap-x-3 text-sm", className)}>
      {phone && (
        <span className="flex items-center gap-1.5 text-slate-600">
          <IconPhone size={16} className="shrink-0 text-slate-400" />
          <span>
            Signed in as <span className="font-semibold text-slate-900">{formatPhone(phone)}</span>
          </span>
        </span>
      )}
      <button
        type="button"
        onClick={onUseDifferentNumber}
        className="min-h-11 rounded-md font-semibold text-primary-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Use a different number
      </button>
    </div>
  );
}
