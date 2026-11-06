import { toHex } from "@illuminize/shared";

/** Every 17th level of each channel, 0 to 255: 4096 colours, the cube's corners and edges included. */
export function sampledColours(): string[] {
  const levels = Array.from({ length: 16 }, (_, i) => i * 17);
  return levels.flatMap((r) => levels.flatMap((g) => levels.map((b) => toHex({ r, g, b }))));
}
