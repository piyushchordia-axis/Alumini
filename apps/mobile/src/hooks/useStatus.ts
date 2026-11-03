import { useEffect, useState } from "react";

/** A line about what just happened, cleared after a while, as the web app's toasts are. */
export function useStatus<T = string>(): [T | null, (value: T | null) => void] {
  const [status, setStatus] = useState<T | null>(null);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(timer);
  }, [status]);
  return [status, setStatus];
}

/** What just happened to one request, said in its own row, where the member is looking, rather than at the top of a long list. */
export interface RowStatus {
  id: string;
  text: string;
  tone: "info" | "warning";
}
