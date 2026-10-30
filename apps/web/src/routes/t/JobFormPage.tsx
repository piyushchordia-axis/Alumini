import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { JobForm } from "@/components/jobs/JobForm";
import { Card, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

export function JobFormPage() {
  const { tenant } = useMembership();
  const slug = tenant.slug;
  const { jobId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: qk.job(slug, jobId ?? ""), queryFn: () => api.jobs.get(slug, jobId!), enabled: !!jobId });
  if (jobId && existing.isLoading) return <Loading />;
  if (jobId && (existing.error || !existing.data)) return <ErrorBox error={existing.error ?? "Not found"} />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={jobId ? "Edit job" : "Post a job"} subtitle="Share an opening or a referral with alumni" />
      <Card className="p-5">
        <JobForm
          initial={existing.data}
          submitLabel={jobId ? "Save changes" : "Post job"}
          onSubmit={async (v) => {
            const job = jobId ? await api.jobs.update(slug, jobId, v) : await api.jobs.create(slug, v);
            void qc.invalidateQueries({ queryKey: ["jobs", slug] });
            void qc.invalidateQueries({ queryKey: ["job", slug] });
            toast.success(job.moderationStatus === "PENDING" ? "Submitted — awaiting admin approval" : "Job published");
            navigate(`/t/${slug}/app/jobs/${job.id}`);
          }}
        />
      </Card>
    </div>
  );
}
