import { Platform } from "react-native";

/**
 * Marks a pressable as unavailable for now while it stays focusable and pressable, such as Send waiting for uploads, or
 * the paperclip at the limit, which says why when pressed. Pass it with `aria-disabled`, which phones read: the browser
 * build's Pressable writes aria-disabled from its `disabled` prop alone, which would also take it out of the tab order
 * and stop the press, but still reads `accessibilityDisabled`. React Native's types omit that prop.
 */
export const heldState = (held: boolean): Record<never, never> => (Platform.OS === "web" && held ? { accessibilityDisabled: true } : {});
