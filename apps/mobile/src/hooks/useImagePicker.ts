import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Platform } from "react-native";
import { api } from "@/lib/api";

/**
 * Picks an image from the library and uploads it to the tenant; resolves with the public URL. Problems are shown with
 * Alert.alert, unless `onError` takes them to show beside the control: Alert.alert shows nothing on the web export.
 */
export function useImageUpload(slug: string, { onError }: { onError?: (message: string) => void } = {}) {
  const [busy, setBusy] = useState(false);
  const fail = (title: string, message: string) => {
    if (onError) onError(`${title}. ${message}`);
    else Alert.alert(title, message);
  };
  const pickAndUpload = async (): Promise<string | null> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      fail("Permission needed", "Allow photo access to attach an image.");
      return null;
    }
    // quality < 1 makes iOS re-encode HEIC photos as JPEG, which the API accepts.
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: false });
    if (res.canceled || !res.assets[0]) return null;
    const asset = res.assets[0];
    // In the browser build the picker hands back a real File (and a blob: or data: uri); native gives a file uri.
    const webFile = Platform.OS === "web" ? (asset.file ?? null) : null;
    const type = webFile?.type || asset.mimeType || "image/jpeg";
    // Check before uploading so a large or unsupported photo fails fast instead of after a slow upload.
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(type)) {
      fail("Unsupported image", "Choose a JPEG, PNG or WebP photo.");
      return null;
    }
    const size = webFile?.size ?? asset.fileSize;
    if (size && size > MAX_UPLOAD_BYTES) {
      fail("Image too large", `Choose a photo under ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`);
      return null;
    }
    setBusy(true);
    try {
      const name = asset.fileName ?? `photo.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
      // FormData needs a Blob in the browser; React Native's FormData takes { uri, name, type }.
      const file =
        Platform.OS === "web" ? (webFile ?? new File([await (await fetch(asset.uri)).blob()], name, { type })) : { uri: asset.uri, name, type };
      const { url } = await api.uploads.upload(slug, file);
      return url;
    } catch (err) {
      fail("Upload failed", errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { pickAndUpload, busy };
}
