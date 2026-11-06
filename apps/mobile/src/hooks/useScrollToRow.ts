import { useRef, type RefObject } from "react";
import type { FlatList } from "react-native";

/**
 * Brings a row of the FlatList at `list` to the top of the screen: the row a link named, or one a press opened out of
 * view. A row not drawn yet (far down a long list) can't be scrolled to straight away, which FlatList reports through
 * `onScrollToIndexFailed`: then it goes to where the row would be by the rows' average height, and tries once more when
 * that part of the list has drawn.
 */
export function useScrollToRow<T>(list: RefObject<FlatList<T> | null>, items: readonly T[], keyOf: (item: T) => string) {
  const retried = useRef(false);
  const reveal = (key: string) => {
    const index = items.findIndex((item) => keyOf(item) === key);
    if (index < 0) return;
    retried.current = false;
    list.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
  };
  const onScrollToIndexFailed = ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
    list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
    if (retried.current) return;
    retried.current = true;
    setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0, animated: true }), 100);
  };
  return { reveal, onScrollToIndexFailed };
}
