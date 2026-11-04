import { imageFileProblem, type UploadPurpose } from "@illuminize/shared";
import { errorMessage, isUploadCancelled, shrinkPhoto, startUpload } from "@illuminize/shared/client";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { api } from "@/lib/api";

export interface ImageUploadOptions {
  /** "avatar" for a profile photo, which the server crops to a square JPEG. */
  purpose?: UploadPurpose;
  /** Offer the platform's square crop after picking. iOS always crops square and the web build has no crop step, so the server's crop is what guarantees the shape. */
  square?: boolean;
  /** Also told what went wrong, for a caller that keeps the message in its own state (the job form's logo). */
  onError?: (message: string) => void;
}

/**
 * Picks an image from the library and uploads it to the tenant; resolves with the public URL, or null when nothing was
 * uploaded. What went wrong is in `error` (and goes to `onError`), for the caller to show beside the control:
 * Alert.alert does nothing in the web build. `cancel` gives up on an upload that is running (it also gives up by itself
 * after a while, and when the screen closes).
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
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        fail("Allow photo access to choose an image.");
        return null;
      }
      let res: ImagePicker.ImagePickerResult;
      try {
        // quality < 1 makes iOS re-encode HEIC photos as JPEG, which the API accepts.
        res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: square, ...(square ? { aspect: [1, 1] as [number, number] } : {}) });
      } catch (err) {
        // The browser build's picker refuses a file that is neither an image nor a video, so say what the web app says.
        // On a phone it fails for other reasons: the photo couldn't be read, or the crop couldn't be saved.
        const unsupported = Platform.OS === "web" || /unsupported file type/i.test(errorMessage(err, ""));
        fail(unsupported ? imageFileProblem({ type: null }) : "Couldn't open that photo. Try another one.");
        return null;
      }
      if (res.canceled || !res.assets[0]) return null;
      const asset = res.assets[0];
      // In the browser build the picker hands back a real File (and a blob: or data: uri); native gives a file uri.
      const picked = Platform.OS === "web" ? (asset.file ?? null) : null;
      const type = picked?.type || asset.mimeType || "image/jpeg";
      // Check before uploading so an unsupported photo fails at once instead of after a slow upload.
      const wrongType = imageFileProblem({ type });
      if (wrongType) {
        fail(wrongType);
        return null;
      }
      setBusy(true);
      // In a browser a large profile photo is shrunk first, as on the web app (a phone's own crop already makes it small).
      const webFile = picked && purpose === "avatar" ? await shrinkPhoto(picked) : picked;
      const tooBig = imageFileProblem({ type: webFile?.type ?? type, size: webFile?.size ?? asset.fileSize });
      if (tooBig) {
        fail(tooBig);
        return null;
      }
      const name = webFile?.name ?? asset.fileName ?? `photo.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
      // FormData needs a Blob in the browser; React Native's FormData takes { uri, name, type }.
      const file =
        Platform.OS === "web" ? (webFile ?? new File([await (await fetch(asset.uri)).blob()], name, { type })) : { uri: asset.uri, name, type };
      const upload = startUpload((signal) => api.uploads.upload(slug, file, { purpose, signal }));
      running.current = upload;
      const { url } = await upload.promise;
      return url;
    } catch (err) {
      if (!isUploadCancelled(err)) fail(errorMessage(err));
      return null;
    } finally {
      running.current = null;
      setBusy(false);
    }
  };
  return { pickAndUpload, busy, error, clearError: () => setError(null), cancel: () => running.current?.cancel() };
}
