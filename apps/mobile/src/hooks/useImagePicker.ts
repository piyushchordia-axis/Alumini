import { IMAGE_TYPE_PROBLEM, imageFileProblem, type UploadPurpose } from "@illuminize/shared";
import { errorMessage, isUploadCancelled, prepareImageFile, startUpload, UploadCancelledError, type NativeFile } from "@illuminize/shared/client";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { api } from "@/lib/api";
import { discardPickedPhoto, discardPreparedPhoto, preparePickedPhoto } from "@/lib/photos";

export interface ImageUploadOptions {
  /** "avatar" for a profile photo, which the server crops to a square JPEG; "backdrop" for the member's background photo. */
  purpose?: UploadPurpose;
  /**
   * Offer the phone's square crop after picking. The web build has no crop step, so the server's crop is what guarantees
   * the shape. The crop keeps the photo's full size; it is prepared like any other pick.
   */
  square?: boolean;
  /** Also told what went wrong, for a caller that keeps the message in its own state (the job form's logo). */
  onError?: (message: string) => void;
}

const UNREADABLE = "Couldn't open that photo. Try another one.";

/** Thrown with words for the member while a pick is being prepared. */
class PickProblem extends Error {}

interface PreparedPick {
  /** What FormData is given: a File in the browser build, { uri, name, type } on a phone. */
  file: File | NativeFile;
  type: string;
  size: number;
  /** The copy prepared on the phone, deleted once it has gone. */
  copy?: string;
}

/**
 * Makes a picked photo into one the server takes, and says what it really is: the picker's type and size describe the
 * source. The browser build's picker hands back a File; a phone's, a file uri.
 */
async function preparePick(asset: ImagePicker.ImagePickerAsset, purpose: UploadPurpose): Promise<PreparedPick> {
  if (Platform.OS === "web") {
    const picked = asset.file ?? new File([await (await fetch(asset.uri)).blob()], asset.fileName ?? "photo", { type: asset.mimeType ?? "" });
    if (!picked.type.startsWith("image/")) throw new PickProblem(IMAGE_TYPE_PROBLEM);
    const file = await prepareImageFile(picked, { purpose });
    return { file, type: file.type, size: file.size };
  }
  let photo;
  try {
    photo = await preparePickedPhoto(asset, purpose);
  } catch {
    throw new PickProblem(UNREADABLE);
  }
  return { file: { uri: photo.uri, name: photo.name, type: photo.type }, type: photo.type, size: photo.size, copy: photo.uri };
}

/**
 * Picks an image from the library, prepares it (see preparePickedPhoto) and uploads it to the tenant; resolves with the
 * public URL, or null when nothing was uploaded. What went wrong is in `error` (and goes to `onError`), for the caller to
 * show beside the control: Alert.alert does nothing in the web build. `cancel` gives up on a photo being prepared or
 * uploaded (an upload also gives up by itself after a while, and both stop when the screen closes).
 */
export function useImageUpload(slug: string, { purpose, square = false, onError }: ImageUploadOptions = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<{ cancel: () => void } | null>(null);
  useEffect(() => () => running.current?.cancel(), []);
  const fail = (message: string | null) => {
    setError(message);
    if (message) onError?.(message);
  };

  const pickAndUpload = async (): Promise<string | null> => {
    setError(null);
    // The temporary files this pick leaves: the picker's copy in the app's cache (on a phone) and the prepared one.
    let picked: string | undefined;
    let copy: string | undefined;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        fail("Allow photo access to choose an image.");
        return null;
      }
      let res: ImagePicker.ImagePickerResult;
      try {
        // At quality 1 the picker hands over a copy of the photo as it is, HEIC included (or, after the crop, at full
        // quality), so preparing it is the one lossy pass. Below 1 it would add its own, and still not help: iOS passes a
        // HEIC through untouched at any quality, and Android reports the source's type and size, not its copy's.
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsEditing: square, ...(square ? { aspect: [1, 1] as [number, number] } : {}) });
      } catch (err) {
        // The browser build's picker refuses a file that is neither an image nor a video, so say what the web app says.
        // On a phone it fails for other reasons: the photo couldn't be read, or the crop couldn't be saved.
        const unsupported = Platform.OS === "web" || /unsupported file type/i.test(errorMessage(err, ""));
        fail(unsupported ? IMAGE_TYPE_PROBLEM : UNREADABLE);
        return null;
      }
      if (res.canceled || !res.assets[0]) return null;
      const asset = res.assets[0];
      setBusy(true);
      if (Platform.OS !== "web") picked = asset.uri;
      // Preparing a large photo takes a moment, and native work can't be stopped: Cancel, or leaving the screen, stops
      // waiting for it at once, and the files it is still using are deleted once it is done with them.
      let giveUp = () => {};
      const givenUp = new Promise<never>((_, reject) => {
        giveUp = () => reject(new UploadCancelledError());
      });
      running.current = { cancel: giveUp };
      const preparing = preparePick(asset, purpose ?? "image");
      const prepared = await Promise.race([preparing, givenUp]).catch((err: unknown) => {
        if (isUploadCancelled(err)) {
          const source = picked;
          picked = undefined;
          void preparing
            .then((late) => late.copy && discardPreparedPhoto(late.copy), () => undefined)
            .then(() => source && discardPickedPhoto(source));
        }
        throw err;
      });
      copy = prepared.copy;
      // Checked before uploading so a photo that still won't do fails at once instead of after a slow upload.
      const problem = imageFileProblem(prepared);
      if (problem) {
        fail(problem);
        return null;
      }
      const upload = startUpload((signal) => api.uploads.upload(slug, prepared.file, { purpose, signal }));
      running.current = upload;
      const { url } = await upload.promise;
      return url;
    } catch (err) {
      if (err instanceof PickProblem) fail(err.message);
      else if (!isUploadCancelled(err)) fail(errorMessage(err));
      return null;
    } finally {
      running.current = null;
      setBusy(false);
      if (copy) discardPreparedPhoto(copy);
      if (picked) discardPickedPhoto(picked);
    }
  };
  return { pickAndUpload, busy, error, clearError: () => setError(null), cancel: () => running.current?.cancel() };
}
