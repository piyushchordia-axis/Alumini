import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "illuminize.pushToken";

/** The Expo push token this device registered with the API, so sign-out can unregister it. */
export async function getRegisteredPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function setRegisteredPushToken(token: string | null): Promise<void> {
  try {
    if (token) await AsyncStorage.setItem(KEY, token);
    else await AsyncStorage.removeItem(KEY);
  } catch {
    /* best effort */
  }
}
