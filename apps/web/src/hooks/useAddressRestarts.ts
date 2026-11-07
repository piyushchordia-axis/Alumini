import { useState } from "react";

/**
 * For a page that writes what's typed into a box into the address as it changes (the console's ?q=, ?action=), keeping
 * the box's own text meanwhile. `restarts` counts the times the address's value (`inAddress`) changed from anywhere
 * else while the page stayed open (a link to the page, such as the console's own nav, or Back to a value left behind):
 * the page keys its body on it and starts again from the address, as the phone app's fresh screen does, rather than
 * write its own text back over it. The body calls `onWrite` with each value just before it writes it.
 */
export function useAddressRestarts(inAddress: string): { restarts: number; onWrite: (value: string) => void } {
  // What the page itself last wrote to the address (or started from), and the address as last seen.
  const [written, setWritten] = useState(inAddress);
  const [seen, setSeen] = useState({ value: inAddress, restarts: 0 });
  if (seen.value !== inAddress) {
    const fromElsewhere = inAddress !== written;
    setSeen({ value: inAddress, restarts: fromElsewhere ? seen.restarts + 1 : seen.restarts });
    if (fromElsewhere) setWritten(inAddress);
  }
  return { restarts: seen.restarts, onWrite: setWritten };
}
