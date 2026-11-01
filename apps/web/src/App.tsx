import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { RealtimeBridge } from "@/components/RealtimeBridge";
import { Toaster } from "@/components/ui";
import { queryClient } from "@/lib/queryClient";
import { router } from "@/router";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeBridge />
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}
