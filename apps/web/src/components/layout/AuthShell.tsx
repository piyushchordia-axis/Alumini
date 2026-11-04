import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TenantPublicDto } from "@illuminize/shared";
import { Avatar } from "@/components/ui";

/** Brand-first layout for landing / login / register / pending pages. */
export function AuthShell({ tenant, title, subtitle, children, wide }: { tenant?: TenantPublicDto | null; title: ReactNode; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  const cover = tenant?.coverImageUrl;
  return (
    <div className="min-h-full bg-[var(--surface-page)]">
      <div className="relative min-h-[42vh] w-full overflow-hidden bg-primary sm:min-h-[48vh]">
        {cover ? (
          <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-secondary opacity-95" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/20 to-black/10" />
        <div className={`relative mx-auto flex h-full min-h-[42vh] w-full flex-col justify-end px-4 pb-28 pt-10 sm:min-h-[48vh] sm:pb-32 ${wide ? "max-w-2xl" : "max-w-md"}`}>
          <div className="flex items-end gap-3 text-white">
            {tenant ? <Avatar name={tenant.shortName ?? tenant.name} src={tenant.logoUrl} size="lg" className="ring-2 ring-white/40" /> : null}
            <div className="min-w-0">
              <p className="font-display text-2xl font-bold tracking-tight drop-shadow sm:text-3xl">{tenant ? (tenant.shortName ?? tenant.name) : "Illuminize"}</p>
              {title && <p className="mt-1 text-sm text-white/85 drop-shadow">{title}</p>}
              {subtitle && <p className="mt-0.5 text-xs text-white/70">{subtitle}</p>}
            </div>
          </div>
        </div>
      </div>
      <div className={`relative z-10 mx-auto -mt-20 w-full px-4 pb-12 ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-white p-6 shadow-[var(--shadow-2)] sm:p-8">{children}</div>
        <p className="mt-6 text-center text-xs text-slate-400">
          <Link to="/" className="hover:underline">
            Choose a different institution
          </Link>
        </p>
      </div>
    </div>
  );
}
