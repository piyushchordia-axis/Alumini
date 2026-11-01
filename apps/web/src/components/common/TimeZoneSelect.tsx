import { COMMON_TIME_ZONES, localTimeZone } from "@illuminize/shared";
import { forwardRef, useMemo, type SelectHTMLAttributes } from "react";
import { Select } from "@/components/ui";

/** Time zone picker: the current value, the device's zone and the common zones (India first). */
export const TimeZoneSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { extra?: Array<string | null | undefined> }>(function TimeZoneSelect(
  { value, extra = [], ...rest },
  ref,
) {
  const options = useMemo(
    () => [...new Set<string>([typeof value === "string" ? value : "", ...extra.map((z) => z ?? ""), localTimeZone(), ...COMMON_TIME_ZONES].filter(Boolean))],
    [value, extra],
  );
  return (
    <Select ref={ref} value={value} {...rest}>
      {options.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </Select>
  );
});
