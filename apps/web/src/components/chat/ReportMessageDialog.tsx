import { REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useState } from "react";
import { Button, FormField, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { toast } from "@/stores/uiStore";

/** Reports one message in a thread. Admins see it with a few messages either side, frozen when it's filed, and nothing else. */
export function ReportMessageDialog({ slug, messageId, onClose }: { slug: string; messageId: string | null; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>("HARASSMENT");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (busy) return;
    setDetails("");
    onClose();
  };
  const submit = async () => {
    if (!messageId) return;
    setBusy(true);
    try {
      await api.chat.report(slug, messageId, { reason, details: details.trim() || null });
      toast.success("Thanks. Admins will take a look.");
      setDetails("");
      onClose();
    } catch (err) {
      // Already reported (or already removed): the outcome they wanted is in place, so it isn't an error to them.
      if (isApiClientError(err) && err.status === 409) {
        toast.info(err.message);
        setDetails("");
        onClose();
      } else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!messageId}
      onClose={close}
      title="Report message"
      footer={
        <>
          <Button variant="ghost" className="min-h-11" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" className="min-h-11" onClick={() => void submit()} loading={busy}>
            Send report
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Admins will see this message and up to 10 around it.</p>
        <FormField label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} className="min-h-11">
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {REPORT_REASON_LABELS[r]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Details (optional)">
          {/* Off, so the browser doesn't keep what's written here for session restore, where it would outlast sign-out. */}
          <Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} placeholder="Anything the admins should know?" autoComplete="off" />
        </FormField>
      </div>
    </Modal>
  );
}
