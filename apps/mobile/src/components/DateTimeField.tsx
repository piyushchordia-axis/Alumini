import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { createElement, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

type Mode = "date" | "datetime";

const pad = (n: number) => String(n).padStart(2, "0");

/** Wall-clock string ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm") → Date with the same local components (what the picker shows). */
function wallToDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(value);
  if (!m) return fallback;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
}

function dateToWall(d: Date, mode: Mode): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return mode === "date" ? date : `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function display(value: string | null, mode: Mode): string {
  if (!value) return "";
  const d = wallToDate(value, new Date());
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (mode === "date") return date;
  return `${date}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export interface DateTimeFieldProps {
  label: string;
  /** Wall-clock value: "YYYY-MM-DD" (date) or "YYYY-MM-DDTHH:mm" (datetime). */
  value: string | null;
  onChange: (value: string | null) => void;
  mode?: Mode;
  error?: string;
  hint?: string;
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  clearable?: boolean;
}

/**
 * Native date / date-time picker. The value is a wall-clock string so the caller decides which
 * time zone it belongs to (events use the event's zone, not the device's).
 */
export function DateTimeField({ label, value, onChange, mode = "datetime", error, hint, placeholder, minimumDate, maximumDate, clearable }: DateTimeFieldProps) {
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(new Date());
  const fallback = minimumDate && minimumDate > new Date() ? minimumDate : maximumDate && maximumDate < new Date() ? maximumDate : new Date();

  const open = () => {
    const current = wallToDate(value, fallback);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: current,
        mode: "date",
        minimumDate,
        maximumDate,
        onChange: (event: DateTimePickerEvent, picked?: Date) => {
          if (event.type !== "set" || !picked) return;
          if (mode === "date") return onChange(dateToWall(picked, "date"));
          DateTimePickerAndroid.open({
            value: picked,
            mode: "time",
            onChange: (e2: DateTimePickerEvent, time?: Date) => {
              if (e2.type !== "set" || !time) return;
              const merged = new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), time.getHours(), time.getMinutes());
              onChange(dateToWall(merged, "datetime"));
            },
          });
        },
      });
      return;
    }
    setDraft(current);
    setIosOpen(true);
  };

  const field =
    Platform.OS === "web" ? (
      // The web preview uses the browser's own picker.
      createElement("input", {
        type: mode === "date" ? "date" : "datetime-local",
        value: value ?? "",
        "aria-label": label,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value || null),
        style: { border: `1px solid ${error ? colors.danger : colors.border}`, borderRadius: radius.md, padding: 10, fontSize: 15, background: "#fff", color: colors.text },
      })
    ) : (
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${label}${value ? `, ${display(value, mode)}` : ""}`}
        style={{ borderWidth: 1, borderColor: error ? colors.danger : colors.border, backgroundColor: "#fff", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 12 }}
      >
        <Text style={{ fontSize: 15, color: value ? colors.text : colors.faint }}>{value ? display(value, mode) : (placeholder ?? (mode === "date" ? "Choose a date" : "Choose date and time"))}</Text>
      </Pressable>
    );

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#334155" }}>{label}</Text>
        {clearable && value ? (
          <Pressable onPress={() => onChange(null)} accessibilityRole="button" accessibilityLabel={`Clear ${label}`}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {field}
      {error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{error}</Text> : hint ? <Text style={{ color: colors.muted, fontSize: 12 }}>{hint}</Text> : null}
      {Platform.OS === "ios" && (
        <Modal visible={iosOpen} transparent animationType="slide" onRequestClose={() => setIosOpen(false)}>
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.4)" }}>
            <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.lg, gap: spacing.md }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>{label}</Text>
              <DateTimePicker
                value={draft}
                mode={mode === "date" ? "date" : "datetime"}
                display="spinner"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={(_e: DateTimePickerEvent, d?: Date) => d && setDraft(d)}
              />
              <Button
                title="Done"
                onPress={() => {
                  onChange(dateToWall(draft, mode));
                  setIosOpen(false);
                }}
              />
              <Button title="Cancel" variant="ghost" onPress={() => setIosOpen(false)} />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}
