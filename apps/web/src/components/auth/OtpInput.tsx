import { OTP_LENGTH } from "@illuminize/shared";
import { Input } from "@/components/ui";

export function OtpInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Input
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d*"
      maxLength={OTP_LENGTH}
      placeholder={"•".repeat(OTP_LENGTH)}
      className="text-center text-2xl tracking-[0.5em]"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
    />
  );
}
