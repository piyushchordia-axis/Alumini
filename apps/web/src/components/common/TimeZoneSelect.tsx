import { timeZoneLabel, timeZoneOptions } from "@illuminize/shared";
import { forwardRef, useMemo, type SelectHTMLAttributes } from "react";
import { Select } from "@/components/ui";

/** Time zone picker: the current value, `extra`, the device's zone and the common zones (India first), each with its offset, as the phone app's TimeZonePicker. */
export const TimeZoneSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { extra?: Array<string | null | undefined> }>(function TimeZoneSelect(
  { value, extra = [], ...rest },
  ref,
) {
  const options = useMemo(() => timeZoneOptions(typeof value === "string" ? value : null, extra), [value, extra]);
  return (
    <Select ref={ref} value={value} {...rest}>
      {options.map((z) => (
        <option key={z} value={z}>
          {timeZoneLabel(z)}
        </option>
      ))}
    </Select>
  );
});
