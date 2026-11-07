import type { ListView, SkeletonShape } from "@illuminize/shared";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Button, ErrorBox, ListSkeleton, LoadMore } from "@/components/ui";

export interface ListState<T> {
  /** From useInfiniteList (`listView`). */
  view: ListView;
  error: unknown;
  items: T[];
  /** useInfiniteList's `retry`, which keeps the error up while it's on its way (`retrying`). */
  retry: () => unknown;
  retrying?: boolean;
  /** What went wrong with the page Load more asked for (useInfiniteList's `nextPageError`). */
  nextPageError?: unknown;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

/**
 * A list that couldn't load and has nothing to show: what went wrong, and a way to try again. While the retry is on its
 * way (`retrying`) the error stays and the button says it's busy without being disabled, so it keeps focus, and a second
 * press does nothing.
 */
export function ListError({ error, onRetry, retrying = false, className }: { error: unknown; onRetry: () => unknown; retrying?: boolean; className?: string }) {
  return (
    <div className={clsx("space-y-3", className)}>
      <ErrorBox error={error} />
      <Button
        variant="outline"
        size="sm"
        className={clsx("min-h-11", retrying && "cursor-wait opacity-70")}
        aria-busy={retrying || undefined}
        aria-disabled={retrying || undefined}
        onClick={() => {
          if (!retrying) void onRetry();
        }}
      >
        {retrying && <span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        Retry loading
      </Button>
    </div>
  );
}

/**
 * A list that draws its outline (`skeleton`, a shared shape) while the first page loads, keeps what it has on screen when
 * a background refetch fails, and says so only with nothing to show, or beside Load more when the next page failed.
 */
export function ListBody<T>({ list, empty, skeleton = "row", children }: { list: ListState<T>; empty: ReactNode; skeleton?: SkeletonShape; children: (items: T[]) => ReactNode }) {
  switch (list.view) {
    case "idle":
      return null;
    case "loading":
      // In the one column the rows below take.
      return <ListSkeleton shape={skeleton} columns={1} />;
    case "error":
      return <ListError error={list.error} onRetry={list.retry} retrying={list.retrying} />;
    case "empty":
      return <>{empty}</>;
    case "rows":
      return (
        <>
          <div className="grid gap-3">{children(list.items)}</div>
          <LoadMore hasNextPage={list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={() => void list.fetchNextPage()} error={list.nextPageError} />
        </>
      );
  }
}
