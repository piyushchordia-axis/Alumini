import { companyDetailsOf, companyDetailsToFill, companyReuseText, latestJobAtCompany, skillKey, tidySkill, type CompanyDetails } from "@illuminize/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { AccessibilityInfo, Platform, Text, View } from "react-native";
import { IconBuilding } from "@/components/icons";
import { Button } from "@/components/ui";
import { useDebounced } from "@/hooks/useDebounced";
import { api } from "@/lib/api";
import { moveFocus } from "@/lib/focus";
import { colors, radius, spacing, useTheme } from "@/theme";

/**
 * "Use details from your last job at Zylo Labs", as on the web app: once the company typed matches one of the poster's own
 * earlier jobs (the latest that wasn't removed), offers to fill in its logo, website, industry, size and about. Only the
 * fields still empty here are filled (and named in the offer), so nothing typed is replaced, and the offer goes once none
 * is left to fill. Under `["jobs", slug]`, so posting or editing a job refreshes it.
 */
export function CompanyReuseOffer({ slug, company, excludeId, current, onUse }: { slug: string; company: string; excludeId?: string; current: CompanyDetails; onUse: (details: Partial<CompanyDetails>) => void }) {
  const theme = useTheme();
  // Tidied as the comparison is, so "zylo  labs" still finds "Zylo Labs" in the search.
  const name = useDebounced(tidySkill(company.normalize("NFKC")), 400);
  const [used, setUsed] = useState<string | null>(null);
  // The button goes once it's pressed, so focus moves to the line that takes its place rather than away from the section.
  const [focusDone, setFocusDone] = useState(false);
  const done = useRef<ComponentRef<typeof View>>(null);
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
  const offered = found && Object.keys(fill).length > 0 ? found.companyName : null;
  const showDone = !!found && !offered && used === found.companyName;
  // Android reads the live region by itself; iOS has to be told.
  useEffect(() => {
    if (offered && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(`You can use details from your last job at ${offered}`);
  }, [offered]);
  useEffect(() => {
    if (focusDone && showDone && done.current) {
      moveFocus(done.current);
      setFocusDone(false);
    }
  }, [focusDone, showDone]);
  // Always there and empty until it has something to say, so a screen reader announces the offer when it appears.
  return (
    <View role="status" accessibilityLiveRegion="polite">
      {offered && found ? (
        <View style={{ gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: theme.primarySoft, backgroundColor: theme.primarySoft, padding: spacing.md }}>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
            <IconBuilding size={20} color={theme.primary} />
            <Text style={{ flex: 1, fontSize: 14, color: "#334155" }}>{companyReuseText(found.companyName, fill)}</Text>
          </View>
          <Button
            title={`Use details from your last job at ${found.companyName}`}
            variant="outline"
            style={{ backgroundColor: colors.card, height: undefined, minHeight: 46, paddingVertical: spacing.sm }}
            onPress={() => {
              onUse(fill);
              setUsed(found.companyName);
              setFocusDone(true);
            }}
          />
        </View>
      ) : showDone ? (
        // Focusable, so focus can land here once the button has gone.
        <View ref={done} accessible tabIndex={-1}>
          <Text style={{ fontSize: 14, color: "#475569" }}>{`Filled in from your last job at ${used}. Check them before you post.`}</Text>
        </View>
      ) : null}
    </View>
  );
}
