import { forgetGuardDataOnAnswer, isApiClientError } from "@illuminize/shared/client";
import { focusManager, QueryCache, QueryClient } from "@tanstack/react-query";
import { AppState, Platform } from "react-native";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: forgetGuardDataOnAnswer }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(isApiClientError(error) && error.status > 0 && error.status < 500) && count < 2,
    },
  },
});

// Refetch stale queries when the app returns to the foreground (React Native has no window focus event).
if (Platform.OS !== "web") {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener("change", (state) => setFocused(state === "active"));
    return () => sub.remove();
  });
}
