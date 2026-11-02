import { QueryCache, QueryClient } from "@tanstack/react-query";
import { forgetGuardDataOnAnswer, isApiClientError } from "@illuminize/shared/client";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: forgetGuardDataOnAnswer }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (isApiClientError(error) && error.status > 0 && error.status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});
