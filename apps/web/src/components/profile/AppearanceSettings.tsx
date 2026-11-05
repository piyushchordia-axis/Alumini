import {
  ALLOWED_IMAGE_MIME,
  BACKDROP_LABELS,
  IMAGE_TYPE_PROBLEM,
  backdropChoices,
  chosenBackdrop,
  imageFileProblem,
  pageBackdrop,
  photoRemoval,
  resolveAppearance,
  type MemberAppearanceUpdate,
  type MemberBackdrop,
  type MembershipDto,
  type PageBackdropSpec,
} from "@illuminize/shared";
import { errorMessage, isUploadCancelled, prepareImageFile, startUpload, UploadCancelledError } from "@illuminize/shared/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { IconCamera, IconCheck, IconImage } from "@/components/icons";
import { Button, Card } from "@/components/ui";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { toast } from "@/stores/uiStore";

/**
 * The member's background for the app at this institution (see pageBackdrop): the plain page, a tint of the institution's
 * colour, its cover, or a photo of their own. It is saved on their membership, so the phone app shows it too. The page
 * behind changes as soon as a tile is chosen, and changes back if the save fails.
 */
export function AppearanceSettings() {
  const { tenant, membership } = useMembership();
  const slug = tenant.slug;
  const qc = useQueryClient();
  const stored = resolveAppearance(membership.appearance);
  // An institution without a cover offers no Cover tile; a member who chose it has the plain page until a cover is back.
  const shown = chosenBackdrop(stored, tenant);
  const options = backdropChoices(tenant);

  const input = useRef<HTMLInputElement>(null);
  const photoTile = useRef<HTMLButtonElement>(null);
  const running = useRef<{ cancel: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Read out politely by screen readers: the upload starting, the photo arriving or going.
  const [status, setStatus] = useState("");
  const headingId = useId();
  const addHintId = useId();

  // Leaving the page gives up on an upload still running.
  useEffect(() => () => running.current?.cancel(), []);

  const mutationKey = ["appearance", slug];
  const setAppearance = (appearance: MembershipDto["appearance"]) => qc.setQueryData<MembershipDto>(qk.membership(slug), (m) => m && { ...m, appearance });
  const save = useMutation({
    mutationKey,
    mutationFn: (change: MemberAppearanceUpdate) => api.membership.updateAppearance(slug, change),
    onMutate: async (change) => {
      await qc.cancelQueries({ queryKey: qk.membership(slug), exact: true });
      const previous = qc.getQueryData<MembershipDto>(qk.membership(slug))?.appearance;
      if (previous) setAppearance({ ...resolveAppearance(previous), ...change });
      return { previous };
    },
    // While a later choice is still on its way, its answer decides what shows, so an earlier one doesn't flash back.
    onError: (err, _change, context) => {
      if (context?.previous && qc.isMutating({ mutationKey }) === 1) setAppearance(context.previous);
      toast.error(errorMessage(err));
    },
    onSuccess: (updated) => {
      if (qc.isMutating({ mutationKey }) === 1) qc.setQueryData(qk.membership(slug), updated);
    },
    // The last save to settle asks the server what it holds: with choices overlapping, an answer dropped while another
    // was on its way, or a rollback to a snapshot a later save had already replaced, would otherwise stay on screen.
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) === 1) void qc.invalidateQueries({ queryKey: qk.membership(slug), exact: true });
    },
  });

  const choose = (backdrop: MemberBackdrop) => {
    setProblem(null);
    if (backdrop === "PHOTO" && !stored.photoUrl) {
      if (!busy) input.current?.click();
      return;
    }
    if (backdrop !== stored.backdrop) save.mutate({ backdrop });
  };

  // As with the profile photo, only the prepared file is checked: a HEIC photo Safari can decode becomes a JPEG.
  const pick = async (picked: File) => {
    setProblem(null);
    if (!picked.type.startsWith("image/")) return setProblem(IMAGE_TYPE_PROBLEM);
    setBusy(true);
    setStatus("Uploading photo…");
    // Cancel while the photo is being prepared stops it going up.
    let cancelled = false;
    running.current = {
      cancel: () => {
        cancelled = true;
      },
    };
    try {
      const file = await prepareImageFile(picked, { purpose: "backdrop" });
      if (cancelled) throw new UploadCancelledError();
      const tooBig = imageFileProblem(file);
      if (tooBig) {
        setProblem(tooBig);
        setStatus("");
        return;
      }
      const upload = startUpload((signal) => api.uploads.upload(slug, file, { purpose: "backdrop", signal }));
      running.current = upload;
      const { url } = await upload.promise;
      save.mutate({ backdrop: "PHOTO", photoUrl: url }, { onSuccess: () => setStatus("Photo added.") });
    } catch (err) {
      if (isUploadCancelled(err)) setStatus("Upload cancelled.");
      else {
        setProblem(errorMessage(err));
        setStatus("");
      }
    } finally {
      running.current = null;
      setBusy(false);
    }
  };

  const removePhoto = () => {
    setProblem(null);
    save.mutate(photoRemoval(stored), { onSuccess: () => setStatus("Photo removed.") });
    // The photo's buttons go with it; the tile that adds one takes the focus.
    photoTile.current?.focus();
  };

  return (
    // Clear of the sticky header when a link jumps here.
    <section id="appearance" aria-labelledby={headingId} className="scroll-mt-20">
      <Card className="p-5">
        <h2 id={headingId} className="font-semibold text-slate-900">
          Appearance
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Your background for {tenant.shortName ?? tenant.name}, on every device. Only you see this. Posts and cards stay white so they're easy to read.
        </p>
        <div role="radiogroup" aria-label="Background" className={clsx("mt-4 grid grid-cols-2 gap-3", options.length > 3 ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
          {options.map((backdrop) => {
            const adding = backdrop === "PHOTO" && !stored.photoUrl;
            return (
              <BackdropTile
                key={backdrop}
                label={BACKDROP_LABELS[backdrop]}
                checked={shown === backdrop}
                buttonRef={backdrop === "PHOTO" ? photoTile : undefined}
                describedBy={adding ? addHintId : undefined}
                busy={adding && busy}
                onSelect={() => choose(backdrop)}
                preview={adding ? <AddPhotoPreview busy={busy} hintId={addHintId} /> : <BackdropPreview spec={pageBackdrop({ backdrop, photoUrl: stored.photoUrl }, tenant)} />}
              />
            );
          })}
        </div>
        <input
          ref={input}
          type="file"
          accept={ALLOWED_IMAGE_MIME.join(",")}
          aria-label="Background photo"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared at once so picking the same file again still fires a change.
            e.target.value = "";
            if (file) void pick(file);
          }}
        />
        {(stored.photoUrl || busy) && (
          <div role="group" aria-label="Your background photo" className="mt-3 flex flex-wrap items-center gap-2">
            {stored.photoUrl && (
              // Stays focusable while uploading (aria-disabled, not disabled), so keyboard focus isn't dropped.
              <Button
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
                {busy ? "Uploading…" : "Change photo"}
              </Button>
            )}
            {busy ? (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => {
                  running.current?.cancel();
                  photoTile.current?.focus();
                }}
              >
                Cancel upload
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="min-h-11" onClick={removePhoto}>
                Remove photo
              </Button>
            )}
          </div>
        )}
        {problem && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {problem}
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {status}
        </p>
      </Card>
    </section>
  );
}

/** One background to choose: a picture of a page with a white card on it, and its name, checked as reactions are. */
function BackdropTile({
  label,
  checked,
  preview,
  busy,
  describedBy,
  buttonRef,
  onSelect,
}: {
  label: string;
  checked: boolean;
  preview: ReactNode;
  busy?: boolean;
  describedBy?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  onSelect: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      onClick={onSelect}
      className={clsx(
        "relative flex min-h-11 w-full flex-col gap-2 rounded-xl p-2 text-left text-sm font-medium transition duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        checked ? "bg-primary-wash text-primary-ink ring-2 ring-primary-ring" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:ring-slate-300",
      )}
    >
      {preview}
      {/* On the preview's corner, not beside the label, so choosing a tile never rewraps its label and moves what's below. */}
      {checked && (
        <span aria-hidden className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary-ink text-white ring-2 ring-white">
          <IconCheck size={13} strokeWidth={2.75} />
        </span>
      )}
      <span className="flex min-h-5 items-center px-0.5">{label}</span>
    </button>
  );
}

/** The page as this background draws it, photo and veil included, under a white card standing for a post. */
function BackdropPreview({ spec }: { spec: PageBackdropSpec }) {
  return (
    <span aria-hidden className="relative block h-16 overflow-hidden rounded-lg ring-1 ring-slate-900/5" style={{ backgroundColor: spec.color }}>
      {spec.imageUrl && (
        <>
          <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${JSON.stringify(spec.imageUrl)})` }} />
          <span className="absolute inset-0" style={{ backgroundColor: spec.color, opacity: spec.scrim }} />
        </>
      )}
      <span className="absolute inset-x-3 bottom-0 top-3 rounded-t-md bg-white px-2 pt-2 shadow-[var(--shadow-1)]">
        <span className="block h-1.5 w-1/2 rounded-full bg-slate-200" />
        <span className="mt-1.5 block h-1.5 w-3/4 rounded-full bg-slate-100" />
      </span>
    </span>
  );
}

/** "Your photo" before there is one: choosing it opens the member's photos. The hint is the tile's description. */
function AddPhotoPreview({ busy, hintId }: { busy: boolean; hintId: string }) {
  return (
    <span aria-hidden className="flex h-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs font-normal text-slate-500">
      {busy ? <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <IconImage size={20} />}
      <span id={hintId}>{busy ? "Uploading…" : "Add a photo"}</span>
    </span>
  );
}
