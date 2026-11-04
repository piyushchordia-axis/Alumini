import { companyDetailsOf, companyDetailsToFill, companyReuseText, latestJobAtCompany, skillKey, tidySkill, type CompanyDetails } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { IconBuilding } from "@/components/icons";
import { Button } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { api } from "@/lib/api";

/**
 * "Use details from your last job at Zylo Labs": once the company typed matches one of the poster's own earlier jobs (the
 * latest that wasn't removed), offers to fill in its logo, website, industry, size and about. Only the fields still empty
 * here are filled (and named in the offer), so nothing typed is replaced, and the offer goes once none is left to fill.
 * Under `["jobs", slug]`, so posting or editing a job refreshes it.
 */
export function CompanyReuseOffer({ slug, company, excludeId, current, onUse }: { slug: string; company: string; excludeId?: string; current: CompanyDetails; onUse: (details: Partial<CompanyDetails>) => void }) {
  // Tidied as the comparison is, so "zylo  labs" still finds "Zylo Labs" in the search.
  const name = useDebounced(tidySkill(company.normalize("NFKC")), 400);
  const [used, setUsed] = useState<string | null>(null);
  // The button goes once it's pressed, so focus moves to the line that takes its place rather than to the top of the page.
  const [focusDone, setFocusDone] = useState(false);
  const done = useRef<HTMLParagraphElement>(null);
  const earlier = useQuery({
    queryKey: ["jobs", slug, "earlierAtCompany", skillKey(name), excludeId ?? null],
    queryFn: async () => {
      // The search also matches titles and skills, so the company itself is matched here. It takes at most 80 characters.
      const mine = await api.jobs.list(slug, { mine: true, q: name.slice(0, 80), limit: 20 });
      const match = latestJobAtCompany(mine.data, name, excludeId);
      if (!match) return null;
      const job = await api.jobs.get(slug, match.id);
      const details = companyDetailsOf(job);
      return details ? { companyName: job.companyName, details } : null;
    },
    enabled: name.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const found = earlier.data && skillKey(company) === skillKey(name) ? earlier.data : null;
  const fill = found ? companyDetailsToFill(found.details, current) : {};
  const offered = found && Object.keys(fill).length > 0;
  const showDone = !!found && !offered && used === found.companyName;
  useEffect(() => {
    if (focusDone && showDone && done.current) {
      done.current.focus();
      setFocusDone(false);
    }
  }, [focusDone, showDone]);
  // Always there and empty until it has something to say, so a screen reader announces the offer when it appears.
  return (
    <div role="status">
      {found && offered ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <IconBuilding size={20} className="text-primary" />
          <p className="min-w-0 flex-1 basis-48 text-sm text-slate-700">{companyReuseText(found.companyName, fill)}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={() => {
              onUse(fill);
              setUsed(found.companyName);
              setFocusDone(true);
            }}
          >
            Use details from your last job at {found.companyName}
          </Button>
        </div>
      ) : showDone ? (
        <p ref={done} tabIndex={-1} className="mt-3 text-sm text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          Filled in from your last job at {used}. Check them before you post.
        </p>
      ) : null}
    </div>
  );
}
