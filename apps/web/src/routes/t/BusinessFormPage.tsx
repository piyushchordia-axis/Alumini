import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { BusinessForm } from "@/components/businesses/BusinessForm";
import { Card, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function BusinessFormPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: qk.business(slug, id ?? ""), queryFn: () => api.businesses.get(slug, id!), enabled: !!id });
  if (id && existing.isLoading) return <Loading />;
  // Only with nothing cached: a failed background refetch must not replace the form and lose what was typed.
  if (id && !existing.data) return <ErrorBox error={existing.error ?? "Not found"} />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={id ? "Edit listing" : "Add a business"} subtitle="Contact details appear only on the listing's own page" />
      <Card className="p-5">
        <BusinessForm
          slug={slug}
          initial={existing.data}
          submitLabel={id ? "Save changes" : "Publish listing"}
          onSubmit={async (v) => {
            const item = id ? await api.businesses.update(slug, id, v) : await api.businesses.create(slug, v);
            void qc.invalidateQueries({ queryKey: ["businesses", slug] });
            toast.success(item.moderationStatus === "PENDING" ? "Submitted — awaiting admin approval" : id ? "Listing saved" : "Listing published");
            navigate(`/t/${slug}/app/businesses/${item.id}`);
          }}
        />
      </Card>
    </div>
  );
}
