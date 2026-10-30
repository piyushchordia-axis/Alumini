import { REPORT_REASONS, REPORT_REASON_LABELS, type ContentType, type ReportReason } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useState } from "react";
import { Button, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { toast } from "@/stores/uiStore";

export function ReportButton({ slug, contentType, contentId, className }: { slug: string; contentType: ContentType; contentId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("SPAM");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.reports.create(slug, { contentType, contentId, reason, details: details || null });
      toast.success("Thanks — the admins will take a look.");
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? "text-xs text-slate-400 hover:text-red-600"}>
        Report
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report content"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void submit()} loading={busy}>
              Submit report
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {REPORT_REASON_LABELS[r]}
              </option>
            ))}
          </Select>
          <Textarea placeholder="Anything the admins should know? (optional)" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
        </div>
      </Modal>
    </>
  );
}
