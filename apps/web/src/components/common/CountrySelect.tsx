import { COUNTRIES } from "@illuminize/shared";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { Select } from "@/components/ui";

export const CountrySelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function CountrySelect(props, ref) {
  return (
    <Select ref={ref} {...props}>
      <option value="">Select country</option>
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </Select>
  );
});
