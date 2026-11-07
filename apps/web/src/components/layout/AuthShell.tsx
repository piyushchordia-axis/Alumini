import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TenantPublicDto } from "@illuminize/shared";
import { BrandCover } from "@/components/layout/BrandCover";

/**
 * Brand-first layout for landing / login / register / pending pages: the brand cover at full height, then the page's
 * card over its foot. With no `title` the cover shows the institution's tagline.
 */
export function AuthShell({ tenant, title, subtitle, children, wide }: { tenant?: TenantPublicDto | null; title?: ReactNode; subtitle?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-full bg-[var(--surface-page)]">
      <BrandCover tenant={tenant} title={title} subtitle={subtitle} wide={wide} />
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
