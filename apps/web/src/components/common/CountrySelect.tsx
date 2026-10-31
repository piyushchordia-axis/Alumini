import { COUNTRIES, POPULAR_COUNTRY_CODES, countryByCode } from "@illuminize/shared";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { Select } from "@/components/ui";

const popular = POPULAR_COUNTRY_CODES.map((c) => countryByCode(c)!).filter(Boolean);

/** Every country by name (type a few letters to jump), with the most common ones grouped at the top. */
export const CountrySelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; emptyLabel?: string }>(function CountrySelect({ emptyLabel = "Select country", ...props }, ref) {
  return (
    <Select ref={ref} {...props}>
      <option value="">{emptyLabel}</option>
      <optgroup label="Popular">
        {popular.map((c) => (
          <option key={`p-${c.code}`} value={c.code}>
            {c.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="All countries">
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </optgroup>
    </Select>
  );
});
