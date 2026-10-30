import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TokenPair, TokenStorage } from "@illuminize/shared/client";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const ACCESS = "illuminize.access";
const REFRESH = "illuminize.refresh";

const secure = {
  get: (k: string) => (Platform.OS === "web" ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === "web" ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: (k: string) => (Platform.OS === "web" ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

/** Tokens live in the device keychain / keystore (AsyncStorage on web). */
export const secureTokenStorage: TokenStorage = {
  getAccessToken: () => secure.get(ACCESS),
  getRefreshToken: () => secure.get(REFRESH),
  async setTokens(t: TokenPair) {
    await Promise.all([secure.set(ACCESS, t.accessToken), secure.set(REFRESH, t.refreshToken)]);
  },
  async clear() {
    await Promise.all([secure.del(ACCESS), secure.del(REFRESH)]);
  },
};
