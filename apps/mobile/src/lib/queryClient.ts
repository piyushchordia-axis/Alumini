import { isApiClientError } from "@illuminize/shared/client";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(isApiClientError(error) && error.status > 0 && error.status < 500) && count < 2,
    },
  },
});
