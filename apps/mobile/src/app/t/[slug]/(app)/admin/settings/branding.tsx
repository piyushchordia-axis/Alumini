import { errorMessage } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { BrandingForm } from "@/components/admin/BrandingForm";
import { StatusLine } from "@/components/Sheet";
import { Button, ErrorText, Spinner } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

type Said = { text: string; tone: "info" | "warning" };

/**
 * The console's Branding (the web's Branding tab), reached from Settings: its own screen on the phone, so the long form
 * and its keyboard never sit under a tab switch. A save refetches the institution, as the web's does, which re-themes
 * the whole app at once (ThemeProvider) and the institution picker's cards.
 */
export default function AdminBrandingScreen() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.admin.settings(slug), queryFn: () => api.admin.settings.get(slug) });
  // What became of Save. Here rather than in the form, which starts again when a new name or colour comes back.
  const [said, setSaid] = useStatus<Said>();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.admin.settings(slug) }),
      qc.invalidateQueries({ queryKey: qk.tenant(slug) }),
      qc.invalidateQueries({ queryKey: ["tenants"] }),
      qc.invalidateQueries({ queryKey: qk.admin.dashboard(slug) }),
    ]);

  if (!q.data) {
    return (
      <AdminScreen title="Branding">
        {/* Only until the first answer: a refetch keeps the form, and what's typed in it. */}
        {q.isLoading && !q.isFetched ? (
          <Spinner label="Loading the branding" />
        ) : (
          <>
            <ErrorText error={q.error ?? "Couldn't load the branding"} />
            <Button title="Try again" variant="outline" onPress={() => void q.refetch()} />
          </>
        )}
      </AdminScreen>
    );
  }

  const branding = q.data.branding;
  return (
    <AdminScreen title="Branding">
      <BrandingForm
        key={branding.name + branding.primaryColor}
        slug={slug}
        initial={branding}
        onInvalid={(text) => setSaid({ text, tone: "warning" })}
        onSubmit={async (input) => {
          // Cleared first, so the same words said again are read out again.
          setSaid(null);
          try {
            await api.admin.settings.updateBranding(slug, input);
          } catch (err) {
            setSaid({ text: `Couldn't save: ${errorMessage(err)}`, tone: "warning" });
            // For the form, to mark the field it's about.
            throw err;
          }
          setSaid({ text: "Branding saved", tone: "info" });
          await refresh();
        }}
      />
      <StatusLine flush text={said?.text ?? null} tone={said?.tone} />
    </AdminScreen>
  );
}
