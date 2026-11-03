import { REPORT_REASONS, REPORT_REASON_LABELS, type ChatReportCreateInput, type ReportReason } from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useState } from "react";
import { Button, FormField, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { toast } from "@/stores/uiStore";

/**
 * A chat report: a reason, optional details, and what admins will see. A second report of the same thing is already in
 * place, so its 409 closes the dialog as done rather than as an error.
 */
export function ChatReportDialog({
  open,
  title,
  intro,
  submit,
  onDone,
  onClose,
}: {
  open: boolean;
  title: string;
  /** What admins will see, said before anything is sent. */
  intro: string;
  submit: (input: ChatReportCreateInput) => Promise<unknown>;
  /** After it's filed, or found already filed. */
  onDone?: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>("HARASSMENT");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (busy) return;
    setDetails("");
    onClose();
  };
  const finish = () => {
    setDetails("");
    onClose();
    onDone?.();
  };
  const send = async () => {
    setBusy(true);
    try {
      await submit({ reason, details: details.trim() || null });
      toast.success("Thanks. Admins will take a look.");
      finish();
    } catch (err) {
      if (isApiClientError(err) && err.status === 409) {
        toast.info(err.message);
        finish();
      } else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <Button variant="ghost" className="min-h-11" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" className="min-h-11" onClick={() => void send()} loading={busy}>
            Send report
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{intro}</p>
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

/** Reports one message in a thread. Admins see it with a few messages either side, frozen when it's filed, and nothing else. */
export function ReportMessageDialog({ slug, messageId, onClose }: { slug: string; messageId: string | null; onClose: () => void }) {
  return (
    <ChatReportDialog
      open={!!messageId}
      title="Report message"
      intro="Admins will see this message and up to 10 around it."
      submit={(input) => api.chat.report(slug, messageId!, input)}
      onClose={onClose}
    />
  );
}
