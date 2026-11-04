import { skillKey, tidySkill } from "@illuminize/shared";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance } from "react-native";
import { IconClose } from "@/components/icons";
import { colors, radius, useTheme } from "@/theme";

/**
 * Keeps the box focused after Return adds a skill. `submitBehavior` says so on a phone; react-native-web only reads the
 * older `blurOnSubmit`, which React Native's types mark as deprecated.
 */
const keepFocusOnWeb = Platform.OS === "web" ? ({ blurOnSubmit: false } as object) : {};

export interface SkillsInputHandle {
  /**
   * Adds what's still typed in the box, as leaving it would, and gives the skills with it. A form calls it before saving:
   * on a phone, tapping the form's button leaves the box focused, so it never loses focus to add them itself.
   */
  commit: () => string[];
}

/**
 * Skills as removable chips, as on the web app's `SkillsInput`. Each is typed and added with Return or a comma, so a pasted
 * "Go, SQL" adds both; leaving the box adds what's left in it. A repeat (by `skillKey`) is dropped, and a skill longer than
 * `maxLength` or past `max` stays in the box with a note saying why. What's added, removed or refused is announced.
 */
export function SkillsInput({
  ref,
  label,
  value,
  onChange,
  max,
  maxLength,
  error,
  hint,
  placeholder,
}: {
  ref?: Ref<SkillsInputHandle>;
  label: string;
  value: string[];
  onChange: (skills: string[]) => void;
  max: number;
  maxLength: number;
  error?: string;
  hint?: string;
  placeholder?: string;
}) {
  const theme = useTheme();
  const input = useRef<TextInputInstance>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  // The web export's live region; a phone's screen reader is told directly.
  const [announced, setAnnounced] = useState("");
  const full = value.length >= max;

  const announce = (message: string) => {
    if (Platform.OS === "web") setAnnounced(message);
    else AccessibilityInfo.announceForAccessibility(message);
  };

  /**
   * Adds every skill in `raw` and gives the skills with them; with `typing`, the part after the last comma is still being
   * typed and stays in the box. What can't be added stays there too, without a trailing comma, which would add it again
   * (and refuse it again) on every Backspace.
   */
  const add = (raw: string, typing: boolean): string[] => {
    const parts = raw.split(",");
    const typed = typing ? parts.pop()!.trimStart() : "";
    const next = [...value];
    const left: string[] = [];
    let problem: string | null = null;
    for (const part of parts) {
      const skill = tidySkill(part);
      if (!skill || next.some((s) => skillKey(s) === skillKey(skill))) continue;
      if (skill.length > maxLength) problem = `Keep each skill to ${maxLength} characters`;
      else if (next.length >= max) problem = `Add at most ${max} skills`;
      else {
        next.push(skill);
        continue;
      }
      left.push(skill);
    }
    const added = next.slice(value.length);
    if (added.length) onChange(next);
    const said = [added.length ? `Added ${added.join(", ")}` : null, problem].filter(Boolean).join(". ");
    if (said) announce(said);
    setText(typing && typed ? [...left, typed].join(", ") : left.join(", "));
    setNote(problem);
    return next;
  };

  useImperativeHandle(ref, () => ({ commit: () => (text.trim() ? add(text, false) : value) }));

  const remove = (skill: string) => {
    onChange(value.filter((s) => s !== skill));
    announce(`Removed ${skill}`);
    setNote(null);
    // The button goes with its chip, so focus goes back to the box rather than to the top of the screen.
    input.current?.focus();
  };

  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={input}
        value={text}
        accessibilityLabel={label}
        placeholder={full ? `${max} skills added` : placeholder}
        placeholderTextColor={colors.faint}
        autoCorrect={false}
        autoComplete="off"
        enterKeyHint="enter"
        submitBehavior="submit"
        {...keepFocusOnWeb}
        onChangeText={(t) => {
          if (t.includes(",")) add(t, true);
          else setText(t);
        }}
        onSubmitEditing={() => {
          if (text.trim()) add(text, false);
        }}
        onBlur={() => {
          if (text.trim()) add(text, false);
        }}
        style={[styles.input, error ? { borderColor: colors.danger } : null]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : note ? <Text style={styles.note}>{note}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {value.length > 0 && (
        <View role="list" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          {value.map((skill) => (
            <View key={skill} role="listitem" style={{ flexDirection: "row", alignItems: "center", maxWidth: "100%", borderRadius: radius.full, backgroundColor: theme.primarySoft, paddingLeft: 12 }}>
              <Text style={{ flexShrink: 1, fontSize: 14, color: theme.primary }}>{skill}</Text>
              {/* A full 44-point target, as hitSlop isn't read on the web export; the circle drawn inside it is 32. */}
              <Pressable onPress={() => remove(skill)} accessibilityRole="button" accessibilityLabel={`Remove ${skill}`} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
                {({ pressed }) => (
                  <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.primarySoft : "transparent" }}>
                    <IconClose size={14} color={theme.primary} />
                  </View>
                )}
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {Platform.OS === "web" && (
        <Text role="status" style={styles.srOnly}>
          {announced}
        </Text>
      )}
    </View>
  );
}

// The same as `Input` in ui.tsx, which can't take the ref this needs to move focus back after a removal.
const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: "#334155" },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text },
  error: { color: colors.danger, fontSize: 12 },
  hint: { color: colors.muted, fontSize: 12 },
  note: { color: "#92400e", fontSize: 12 },
  // Read by a screen reader, unseen.
  srOnly: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
});
