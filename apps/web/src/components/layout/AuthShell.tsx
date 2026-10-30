import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TenantPublicDto } from "@illuminize/shared";
import { Avatar } from "@/components/ui";

/** Centered card layout for landing / login / register / pending pages. */
export function AuthShell({ tenant, title, subtitle, children, wide }: { tenant?: TenantPublicDto | null; title: ReactNode; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-full bg-slate-50">
      <div
        className="h-40 w-full bg-primary bg-cover bg-center"
        style={tenant?.coverImageUrl ? { backgroundImage: `url(${tenant.coverImageUrl})` } : undefined}
      />
      <div className={`mx-auto -mt-20 w-full px-4 pb-12 ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <div className="rounded-2xl bg-white p-6 shadow-lg sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            {tenant ? <Avatar name={tenant.shortName ?? tenant.name} src={tenant.logoUrl} size="lg" /> : <span className="text-3xl">✨</span>}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{tenant ? tenant.name : "Illuminize"}</div>
              <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
              {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          <Link to="/" className="hover:underline">
            Choose a different institution
          </Link>
        </p>
      </div>
    </div>
  );
}
