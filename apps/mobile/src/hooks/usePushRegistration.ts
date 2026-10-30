import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { AndroidImportance } from "expo-notifications";
import { useEffect } from "react";
import { Platform } from "react-native";
import { api } from "@/lib/api";

/** Registers the device's Expo push token with the API once the user is signed in. */
export function usePushRegistration(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !Device.isDevice || Platform.OS === "web") return;
    let cancelled = false;
    (async () => {
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        const status = existing === "granted" ? existing : (await Notifications.requestPermissionsAsync()).status;
        if (status !== "granted") return;
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", { name: "Default", importance: AndroidImportance.DEFAULT });
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
