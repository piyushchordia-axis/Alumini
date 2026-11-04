import { AccessibilityInfo, Platform, type HostInstance } from "react-native";

/**
 * Moves a screen reader to `node`, or on the web export the keyboard focus (give a non-button `tabIndex={-1}`), for when
 * the control just pressed has gone and focus would otherwise fall to the top of the screen.
 */
export function moveFocus(node: HostInstance | null | undefined) {
  if (!node) return;
  if (Platform.OS === "web") (node as unknown as { focus?: () => void }).focus?.();
  else AccessibilityInfo.sendAccessibilityEvent(node, "focus");
}
