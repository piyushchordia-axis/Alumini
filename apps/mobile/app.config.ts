import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Extends app.json with values that differ per environment.
 *
 * EAS_PROJECT_ID: the Expo project id (expo.dev → project → Overview, or `eas init`). Expo needs it to issue push
 * tokens in development and store builds; without it the app skips push registration.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EAS_PROJECT_ID || undefined;
  return {
    ...config,
    name: config.name ?? "Illuminize",
    slug: config.slug ?? "illuminize",
    // Screens are designed light-only; this keeps system UI (pickers, alerts) consistent with them.
    userInterfaceStyle: "light",
    plugins: [
      ...(config.plugins ?? []),
      ["expo-notifications", { color: "#1d4ed8" }],
      ["expo-image-picker", { photosPermission: "Illuminize uses your photos so you can add a profile picture and share images with your alumni network.", cameraPermission: false, microphonePermission: false }],
      "expo-secure-store",
    ],
    extra: {
      ...config.extra,
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
