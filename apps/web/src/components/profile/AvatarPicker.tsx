import { ALLOWED_IMAGE_MIME, IMAGE_TYPE_PROBLEM, imageFileProblem } from "@illuminize/shared";
import { errorMessage, isUploadCancelled, prepareImageFile, startUpload, UploadCancelledError } from "@illuminize/shared/client";
import { useEffect, useId, useRef, useState } from "react";
import { IconCamera } from "@/components/icons";
import { Avatar, Button } from "@/components/ui";
import { api } from "@/lib/api";

/**
 * The member's profile photo: a round preview (initials until there is one), and buttons to add, change or remove it. A
 * large photo is shrunk in the browser first, then uploaded as an avatar, which the server crops to a square; only such
 * an upload is accepted as a profile photo. `error` is the form's message for the photo (from the server); a problem
 * with the picked file shows in its place. `onBusyChange` tells the form while an upload is running, so it can hold
 * back saving until the photo is in.
 */
export function AvatarPicker({
  slug,
  name,
  value,
  onChange,
  error,
  onBusyChange,
}: {
  slug: string;
  name: string;
  value: string | null;
  onChange: (url: string | null) => void;
  error?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  const running = useRef<{ cancel: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Read out politely by screen readers: the upload starting, the photo arriving or going.
  const [status, setStatus] = useState("");
  const titleId = useId();
  const hintId = useId();
  const message = problem ?? error;
  const uploading = (on: boolean) => {
    setBusy(on);
    onBusyChange?.(on);
  };

  // Leaving the page gives up on an upload still running.
  useEffect(() => () => running.current?.cancel(), []);

  // As with ImageUploader, only the prepared file is checked: a HEIC photo Safari can decode becomes a JPEG.
  const pick = async (picked: File) => {
    setProblem(null);
    if (!picked.type.startsWith("image/")) return setProblem(IMAGE_TYPE_PROBLEM);
    uploading(true);
    setStatus("Uploading photo…");
    // Cancel while the photo is being prepared stops it going up.
    let cancelled = false;
    running.current = {
      cancel: () => {
        cancelled = true;
      },
    };
    try {
      const file = await prepareImageFile(picked, { purpose: "avatar" });
      if (cancelled) throw new UploadCancelledError();
      const tooBig = imageFileProblem(file);
      if (tooBig) {
        setProblem(tooBig);
        setStatus("");
        return;
      }
      const upload = startUpload((signal) => api.uploads.upload(slug, file, { purpose: "avatar", signal }));
      running.current = upload;
      const { url } = await upload.promise;
      onChange(url);
      setStatus("Photo added.");
    } catch (err) {
      if (isUploadCancelled(err)) setStatus("Upload cancelled.");
      else {
        setProblem(errorMessage(err));
        setStatus("");
      }
    } finally {
      running.current = null;
      uploading(false);
    }
  };

  return (
    <div role="group" aria-labelledby={titleId} aria-describedby={hintId} className="flex flex-col items-center gap-4 rounded-xl border border-[var(--border-subtle)] bg-slate-50 p-4 text-center sm:flex-row sm:text-left">
      <Avatar name={name} src={value} size="xl" className="ring-4 ring-white shadow-[var(--shadow-1)]" />
      <div className="min-w-0 flex-1">
        <p id={titleId} className="font-display text-sm font-semibold text-slate-900">
          Profile photo
        </p>
        <p id={hintId} className="mt-0.5 text-sm text-slate-500">
          Members recognise faces first. Large photos are made smaller for you.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          <input
            ref={input}
            type="file"
            accept={ALLOWED_IMAGE_MIME.join(",")}
            aria-label="Profile photo"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared at once so picking the same file again still fires a change.
              e.target.value = "";
              if (file) void pick(file);
            }}
          />
          {/* Stays focusable while uploading (aria-disabled, not disabled), so keyboard focus isn't dropped. */}
          <Button
            ref={choose}
            type="button"
            variant="outline"
            className="min-h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            onClick={() => {
              if (busy) return;
              setProblem(null);
              input.current?.click();
            }}
          >
            {busy ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <IconCamera size={18} />}
            {busy ? "Uploading…" : value ? "Change photo" : "Add photo"}
          </Button>
          {busy ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                running.current?.cancel();
                choose.current?.focus();
              }}
            >
              Cancel upload
            </Button>
          ) : value ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => {
                setProblem(null);
                onChange(null);
                setStatus("Photo removed.");
                // This button goes with the photo; focus moves to the one that adds a new photo.
                choose.current?.focus();
              }}
            >
              Remove photo
            </Button>
          ) : null}
        </div>
        {message && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {message}
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {status}
        </p>
      </div>
    </div>
  );
}
