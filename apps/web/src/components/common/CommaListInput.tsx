import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui";

export function splitCommaList(text: string, max: number): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

/**
 * A text input for a list of short values typed as "a, b, c". It keeps the text the user typed (so a trailing comma
 * or space survives while they type the next item) and reports the parsed list on every change.
 */
export function CommaListInput({ value, onChange, max, placeholder, ...rest }: { value: string[] | null | undefined; onChange: (v: string[]) => void; max: number; placeholder?: string; "aria-label"?: string; onBlur?: () => void }) {
  const [text, setText] = useState(() => (value ?? []).join(", "));
  const last = useRef<string[]>(value ?? []);
  useEffect(() => {
    const next = value ?? [];
    // Only overwrite the text when the list changed from outside (form reset), not as an echo of our own onChange.
    if (next.join("\u0000") !== last.current.join("\u0000")) {
      last.current = next;
      setText(next.join(", "));
    }
  }, [value]);
  return (
    <Input
      {...rest}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        const list = splitCommaList(e.target.value, max);
        last.current = list;
        onChange(list);
      }}
    />
  );
}
