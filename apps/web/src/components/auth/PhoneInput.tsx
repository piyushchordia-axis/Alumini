import { COUNTRIES, POPULAR_COUNTRY_CODES, clampNationalNumber, countryByCode, flagEmoji } from "@illuminize/shared";
import { Input } from "@/components/ui";

export interface PhoneValue {
  /** ISO country code; the calling code comes from it (US and CA both dial +1 but stay distinct). */
  country: string;
  number: string;
}

const popular = POPULAR_COUNTRY_CODES.map((c) => countryByCode(c)!).filter(Boolean);

/**
 * Country code + national number. The native <select> lists every country by name (type-ahead works), while the
 * closed control shows just the flag and calling code so it stays narrow on phones. National digits are capped per
 * country (India: 10).
 */
export function PhoneInput({ value, onChange, autoFocus }: { value: PhoneValue; onChange: (v: PhoneValue) => void; autoFocus?: boolean }) {
  const selected = countryByCode(value.country) ?? COUNTRIES[0]!;
  return (
    <div className="flex gap-2">
      <div className="relative w-28 shrink-0">
        <div aria-hidden className="pointer-events-none flex h-10 items-center justify-between gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
          <span>
            {flagEmoji(selected.code)} {selected.dial}
          </span>
          <span className="text-slate-400">▾</span>
        </div>
        <select
          aria-label={`Country code, ${selected.name} ${selected.dial}`}
          value={selected.code}
          onChange={(e) => {
            const country = e.target.value;
            onChange({ country, number: clampNationalNumber(country, value.number) });
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        >
          <optgroup label="Popular">
            {popular.map((c) => (
              <option key={`p-${c.code}`} value={c.code}>
                {c.name} ({c.dial})
              </option>
            ))}
          </optgroup>
          <optgroup label="All countries">
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.dial})
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="Mobile number"
        aria-label="Mobile number"
        value={value.number}
        autoFocus={autoFocus}
        onChange={(e) => onChange({ ...value, number: clampNationalNumber(value.country, e.target.value) })}
      />
    </div>
  );
}

export function toE164(v: PhoneValue): string {
  const dial = countryByCode(v.country)?.dial ?? "+91";
  return `${dial}${v.number.replace(/\D/g, "")}`;
}
