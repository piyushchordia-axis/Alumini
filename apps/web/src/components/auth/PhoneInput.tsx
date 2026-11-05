import { COUNTRIES, POPULAR_COUNTRY_CODES, countryByCode, flagEmoji, phoneCountryNote, readPhoneEntry, type PhoneEntry } from "@illuminize/shared";
import { useState } from "react";
import { Input } from "@/components/ui";

const popular = POPULAR_COUNTRY_CODES.map((c) => countryByCode(c)!).filter(Boolean);

/**
 * Country code + national number. The native <select> lists every country by name (type-ahead works), while the
 * closed control shows just the flag and calling code so it stays narrow on phones. Every change goes through
 * readPhoneEntry, so a pasted or autofilled "+44…" moves the country and the box keeps the national number.
 */
export function PhoneInput({ value, onChange, autoFocus }: { value: PhoneEntry; onChange: (v: PhoneEntry) => void; autoFocus?: boolean }) {
  const selected = countryByCode(value.country) ?? COUNTRIES[0]!;
  // Said when the box, not the picker, moves the country: the picker's own change is already announced.
  const [note, setNote] = useState("");
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
            setNote("");
            onChange(readPhoneEntry(e.target.value, value.held ?? value.number));
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
        name="phone"
        autoComplete="tel"
        placeholder="Mobile number"
        aria-label="Mobile number"
        value={value.number}
        autoFocus={autoFocus}
        onChange={(e) => {
          const next = readPhoneEntry(value.country, e.target.value, value);
          if (next.country !== value.country) setNote(phoneCountryNote(next.country));
          onChange(next);
        }}
      />
      <span className="sr-only" role="status" aria-live="polite">
        {note}
      </span>
    </div>
  );
}
