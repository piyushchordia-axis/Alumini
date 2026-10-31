import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@illuminize/shared";
import { errorMessage } from "@illuminize/shared/client";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert } from "react-native";
import { api } from "@/lib/api";

/** Picks an image from the library and uploads it to the tenant; resolves with the public URL. */
export function useImageUpload(slug: string) {
  const [busy, setBusy] = useState(false);
  const pickAndUpload = async (): Promise<string | null> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo access to attach an image.");
      return null;
    }
    // quality < 1 makes iOS re-encode HEIC photos as JPEG, which the API accepts.
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsEditing: false });
    if (res.canceled || !res.assets[0]) return null;
    const asset = res.assets[0];
    const type = asset.mimeType ?? "image/jpeg";
    // Check before uploading so a large or unsupported photo fails fast instead of after a slow upload.
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(type)) {
      Alert.alert("Unsupported image", "Choose a JPEG, PNG or WebP photo.");
      return null;
    }
    if (asset.fileSize && asset.fileSize > MAX_UPLOAD_BYTES) {
      Alert.alert("Image too large", `Choose a photo under ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`);
      return null;
    }
    setBusy(true);
    try {
      const name = asset.fileName ?? `photo.${type === "image/png" ? "png" : "jpg"}`;
      const { url } = await api.uploads.upload(slug, { uri: asset.uri, name, type });
      return url;
    } catch (err) {
      Alert.alert("Upload failed", errorMessage(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { pickAndUpload, busy };
}
