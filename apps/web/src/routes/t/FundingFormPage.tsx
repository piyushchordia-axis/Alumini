import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PageLoad } from "@/components/common/PageLoad";
import { FundingForm } from "@/components/funding/FundingForm";
import { Card, PageHeader } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { usePageQuery } from "@/hooks/usePageQuery";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function FundingFormPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: qk.fundingItem(slug, id ?? ""), queryFn: () => api.funding.get(slug, id!), enabled: !!id });
  const page = usePageQuery(existing);
  // Only with nothing to show: a failed background refetch must not replace the form and lose what was typed.
  if (id && !existing.data)
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Edit listing" />
        <PageLoad page={page} shape="form" />
      </div>
    );
  const kind = existing.data?.kind ?? (params.get("kind") === "OFFERING" ? "OFFERING" : "SEEKING");
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={id ? "Edit listing" : kind === "SEEKING" ? "Raise from alumni" : "Offer to invest"} />
      <Card className="p-5">
        <FundingForm
          kind={kind}
          initial={existing.data}
          submitLabel={id ? "Save changes" : "Publish listing"}
          onSubmit={async (v) => {
            const { kind: _k, ...rest } = v;
            const item = id ? await api.funding.update(slug, id, rest) : await api.funding.create(slug, v);
            void qc.invalidateQueries({ queryKey: ["funding", slug] });
            toast.success(item.moderationStatus === "PENDING" ? "Submitted — awaiting admin approval" : "Listing published");
            navigate(`/t/${slug}/app/funding/${item.id}`);
          }}
        />
      </Card>
    </div>
  );
}
