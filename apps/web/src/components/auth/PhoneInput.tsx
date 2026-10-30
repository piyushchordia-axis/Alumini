import { COUNTRIES } from "@illuminize/shared";
import { Input, Select } from "@/components/ui";

export interface PhoneValue {
  dial: string;
  number: string;
}

export function PhoneInput({ value, onChange, autoFocus }: { value: PhoneValue; onChange: (v: PhoneValue) => void; autoFocus?: boolean }) {
  return (
    <div className="flex gap-2">
      <Select value={value.dial} onChange={(e) => onChange({ ...value, dial: e.target.value })} className="w-36" aria-label="Country code">
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.dial}>
            {c.code} {c.dial}
          </option>
        ))}
      </Select>
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="Mobile number"
        value={value.number}
        autoFocus={autoFocus}
        onChange={(e) => onChange({ ...value, number: e.target.value.replace(/[^\d\s-]/g, "") })}
      />
    </div>
  );
}

export function toE164(v: PhoneValue): string {
  return `${v.dial}${v.number.replace(/\D/g, "")}`;
}
