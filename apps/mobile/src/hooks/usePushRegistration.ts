import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import { useEffect } from "react";
import { Platform } from "react-native";
import { api } from "@/lib/api";

/** Expo Go cannot receive remote push notifications (removed on Android in SDK 53), so skip it there. */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Registers the device's Expo push token with the API once the user is signed in (development and store builds only). */
export function usePushRegistration(enabled: boolean) {
  useEffect(() => {
    if (!enabled || isExpoGo || !Device.isDevice || Platform.OS === "web") return;
    let cancelled = false;
    (async () => {
      try {
        // Loaded lazily so Expo Go never evaluates the module.
        const Notifications = await import("expo-notifications");
        const { status: existing } = await Notifications.getPermissionsAsync();
        const status = existing === "granted" ? existing : (await Notifications.requestPermissionsAsync()).status;
        if (status !== "granted") return;
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", { name: "Default", importance: Notifications.AndroidImportance.DEFAULT });
        }
        const token = (await Notifications.getExpoPushTokenAsync()).data;
        if (!cancelled) await api.me.registerPushToken({ token, platform: Platform.OS === "ios" ? "IOS" : "ANDROID" });
      } catch {
        /* push is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
