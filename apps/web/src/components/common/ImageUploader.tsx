import { ALLOWED_IMAGE_MIME, imageFileProblem } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import clsx from "clsx";
import { useRef, useState } from "react";
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
  const [busy, setBusy] = useState(false);
  // Shown beside the button, in the same words as the profile photo picker and the mobile app.
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async (file: File) => {
    setProblem(null);
    const bad = imageFileProblem(file);
    if (bad) {
      if (ref.current) ref.current.value = "";
      return setProblem(bad);
    }
    setBusy(true);
    onBusyChange?.(true);
    try {
      const { url } = await api.uploads.upload(slug, file);
      onChange([...urls, url].slice(0, max));
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      if (ref.current) ref.current.value = "";
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
