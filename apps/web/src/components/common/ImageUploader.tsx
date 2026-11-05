import { ALLOWED_IMAGE_MIME, IMAGE_TYPE_PROBLEM, imageFileProblem } from "@illuminize/shared";
import { errorMessage, isUploadCancelled, prepareImageFile, startUpload } from "@illuminize/shared/client";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { IconClose, IconImage } from "@/components/icons";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";

export function ImageUploader({
  slug,
  urls,
  onChange,
  max = 1,
  label = "Add image",
  removeLabel = "Remove image",
  showPreviews = true,
  showTrigger = true,
  triggerClassName,
  onBusyChange,
}: {
  slug: string;
  urls: string[];
  onChange: (urls: string[]) => void;
  max?: number;
  label?: string;
  removeLabel?: string;
  showPreviews?: boolean;
  showTrigger?: boolean;
  triggerClassName?: string;
  /** Told when an upload starts and ends, so a form can wait for it rather than save without the image. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const running = useRef<{ cancel: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  // Shown beside the button, in the same words as the profile photo picker and the mobile app.
  const [problem, setProblem] = useState<string | null>(null);

  // Leaving the page gives up on an upload still running.
  useEffect(() => () => running.current?.cancel(), []);

  // The picked file's type and size describe the source: a large photo is made smaller, and one the browser can decode but
  // the server can't take (HEIC in Safari) becomes a JPEG, so only the prepared file is checked.
  const pick = async (picked: File) => {
    setProblem(null);
    if (ref.current) ref.current.value = "";
    if (!picked.type.startsWith("image/")) return setProblem(IMAGE_TYPE_PROBLEM);
    setBusy(true);
    onBusyChange?.(true);
    let cancelled = false;
    running.current = {
      cancel: () => {
        cancelled = true;
      },
    };
    try {
      const file = await prepareImageFile(picked, { purpose: "image" });
      if (cancelled) return;
      const bad = imageFileProblem(file);
      if (bad) return setProblem(bad);
      const upload = startUpload((signal) => api.uploads.upload(slug, file, { signal }));
      running.current = upload;
      const { url } = await upload.promise;
      onChange([...urls, url].slice(0, max));
    } catch (err) {
      if (!isUploadCancelled(err)) setProblem(errorMessage(err));
    } finally {
      running.current = null;
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showPreviews &&
        urls.map((u) => (
          <div key={u} className="relative">
            <img src={u} alt="" className="h-20 w-20 rounded-lg object-cover" />
            <button type="button" onClick={() => onChange(urls.filter((x) => x !== u))} className="absolute -right-1 -top-1 rounded-full bg-slate-900 p-1 text-white" aria-label={removeLabel}>
              <IconClose size={12} />
            </button>
          </div>
        ))}
      {showTrigger && urls.length < max && (
        <>
          {/* No HEIC in the list, so iPhone Safari hands a HEIC photo over as a JPEG. */}
          <input ref={ref} type="file" accept={ALLOWED_IMAGE_MIME.join(",")} className="hidden" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={busy}
            className={clsx("gap-1.5", triggerClassName)}
            onClick={() => {
              setProblem(null);
              ref.current?.click();
            }}
          >
            <IconImage size={16} />
            {label}
          </Button>
        </>
      )}
      {problem && (
        <p role="alert" className="w-full text-sm text-red-600">
          {problem}
        </p>
      )}
    </div>
  );
}
