import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import { useEffect } from "react";
import { Platform } from "react-native";
import { api } from "@/lib/api";
import { setRegisteredPushToken } from "@/lib/push";

/** Expo Go cannot receive remote push notifications (removed on Android in SDK 53), so push is skipped there. */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Push works in development and store builds on a real device. */
export const pushSupported = !isExpoGo && Device.isDevice && Platform.OS !== "web";

/** The EAS project id (app.config.ts reads EAS_PROJECT_ID); Expo needs it to issue push tokens. */
export function easProjectId(): string | undefined {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? undefined;
}

async function register(token: string) {
  await api.me.registerPushToken({ token, platform: Platform.OS === "ios" ? "IOS" : "ANDROID" });
  // Remembered so sign-out can unregister this device.
  await setRegisteredPushToken(token);
}

/** Registers the device's Expo push token with the API once the member is signed in, and again if Expo rotates it. */
export function usePushRegistration(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !pushSupported) return;
    const projectId = easProjectId();
    if (!projectId) {
      if (__DEV__) console.info("Push notifications are off: set EAS_PROJECT_ID (see apps/mobile/.env.example).");
      return;
    }
    let cancelled = false;
    let subscription: { remove: () => void } | undefined;
    (async () => {
      try {
        // Loaded lazily so Expo Go never evaluates the module.
        const Notifications = await import("expo-notifications");
        if (Platform.OS === "android") {
          // Android 13+ only shows the permission prompt once a channel exists.
          await Notifications.setNotificationChannelAsync("default", { name: "Default", importance: Notifications.AndroidImportance.DEFAULT });
        }
        const { status: existing } = await Notifications.getPermissionsAsync();
        const status = existing === "granted" ? existing : (await Notifications.requestPermissionsAsync()).status;
        if (status !== "granted" || cancelled) return;
        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
        if (cancelled) return;
        await register(token);
        // The native device token can change (restore, reinstall of services); ask Expo for the matching push token.
        subscription = Notifications.addPushTokenListener(() => {
          Notifications.getExpoPushTokenAsync({ projectId })
            .then(({ data }) => register(data))
            .catch(() => undefined);
        });
      } catch {
        /* push is best-effort */
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled]);
}
