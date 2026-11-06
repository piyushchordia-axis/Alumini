import { timeZoneLabel, timeZoneOptions } from "@illuminize/shared";
import { OptionPicker } from "@/components/OptionPicker";

/**
 * A field that opens the list of time zones (timeZoneOptions), each with its offset now: the chosen one first, then
 * `extra` (a zone saved before, so choosing another doesn't drop it from the list; the institution's), the phone's and
 * the common ones. As the web app's TimeZoneSelect.
 */
export function TimeZonePicker({
  label = "Time zone",
  value,
  extra,
  onChange,
  hint,
  error,
}: {
  label?: string;
  value: string;
  extra?: readonly (string | null | undefined)[];
  onChange: (zone: string) => void;
  hint?: string;
  error?: string;
}) {
  const options = timeZoneOptions(value, extra).map((zone) => ({ value: zone, label: timeZoneLabel(zone) }));
  return <OptionPicker label={label} value={value} options={options} onChange={(zone) => zone && onChange(zone)} hint={hint} error={error} />;
}
