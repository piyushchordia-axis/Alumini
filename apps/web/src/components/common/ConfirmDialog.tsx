import { errorMessage } from "@illuminize/shared/client";
import { Button, Modal } from "@/components/ui";

/**
 * Asks before a destructive or hard-to-undo action. Use this rather than window.confirm in new flows: it matches the
 * rest of the app, and a browser test can drive it without handling a native dialog.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  /** Why the action failed, shown in the dialog, which stays open so it can be tried again. */
  error?: unknown;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = () => {
    if (!busy) onCancel();
  };
  return (
    <Modal
      open={open}
      onClose={cancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" className="min-h-11" onClick={cancel} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} className="min-h-11" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body ? <p className="text-sm text-slate-600">{body}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
    </Modal>
  );
}
