import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { toast } from "@/stores/uiStore";

export function ImageUploader({ slug, urls, onChange, max = 1, label = "Add image" }: { slug: string; urls: string[]; onChange: (urls: string[]) => void; max?: number; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File) => {
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) return toast.error("Only JPEG, PNG or WebP images are allowed");
    if (file.size > MAX_UPLOAD_BYTES) return toast.error("Image must be under 5 MB");
    setBusy(true);
    try {
      const { url } = await api.uploads.upload(slug, file);
      onChange([...urls, url].slice(0, max));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {urls.map((u) => (
        <div key={u} className="relative">
          <img src={u} alt="" className="h-20 w-20 rounded-lg object-cover" />
          <button type="button" onClick={() => onChange(urls.filter((x) => x !== u))} className="absolute -right-1 -top-1 rounded-full bg-slate-900 px-1.5 text-xs text-white" aria-label="Remove image">
            ✕
          </button>
        </div>
      ))}
      {urls.length < max && (
        <>
          <input ref={ref} type="file" accept={ALLOWED_IMAGE_MIME.join(",")} className="hidden" onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
          <Button type="button" variant="outline" size="sm" loading={busy} onClick={() => ref.current?.click()}>
            📷 {label}
          </Button>
        </>
      )}
    </div>
  );
}
