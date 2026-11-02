import type { ModerationStatus } from "@illuminize/shared";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui";

/** A list card that opens its detail page. A removed item's page 404s even for its author, so that card opens nothing. */
export function ContentCard({ to, status, className, children }: { to: string; status: ModerationStatus; className?: string; children: ReactNode }) {
  if (status === "REMOVED") return <Card className={className}>{children}</Card>;
  return (
    <Link to={to}>
      <Card className={clsx(className, "transition hover:border-slate-300 hover:shadow")}>{children}</Card>
    </Link>
  );
}
