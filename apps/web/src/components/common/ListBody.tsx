import type { ReactNode } from "react";
import { Button, ErrorBox, LoadMore, Loading } from "@/components/ui";

export interface ListState<T> {
  isLoading: boolean;
  error: unknown;
  items: T[];
  refetch: () => unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

/** A list that keeps what it has on screen when a background refetch fails, and says so only with nothing to show. */
export function ListBody<T>({ list, empty, children }: { list: ListState<T>; empty: ReactNode; children: (items: T[]) => ReactNode }) {
  if (list.isLoading) return <Loading />;
  if (list.error && list.items.length === 0)
    return (
      <div className="space-y-3">
        <ErrorBox error={list.error} />
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => void list.refetch()}>
          Retry loading
        </Button>
      </div>
    );
  if (list.items.length === 0) return <>{empty}</>;
  return (
    <>
      <div className="grid gap-3">{children(list.items)}</div>
      <LoadMore hasNextPage={list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} />
    </>
  );
}
