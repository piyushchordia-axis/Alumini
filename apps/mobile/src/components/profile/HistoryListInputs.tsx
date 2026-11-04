import { PROFILE_DEGREE_MAX_LENGTH, PROFILE_HISTORY_NAME_MAX_LENGTH, PROFILE_MAX_EDUCATION, PROFILE_MAX_EXPERIENCES, profileYearsLabel } from "@illuminize/shared";
import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { yearDigits, type ProfileDraftController, type ProfileListKey } from "@/components/profile/useProfileDraft";
import { Button, FieldError, Input, Muted, focusOn, headingRole, type Focusable } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

type TextBox = ComponentRef<typeof TextInput>;
/** Hands a row's text box, by its field ("endYear"), to the list, which focuses the one Done refuses. */
type BoxRef = (field: string) => (node: TextBox | null) => void;

interface Row {
  key: string;
  /** What the row is, for its buttons' names: "Software engineer at Flipkart". */
  name: string;
  title: string;
  detail: string | null;
  when: string;
  /** Its inputs, the first taking focus when `autoFocus`, each passing itself to `box`. */
  editor: (autoFocus: boolean, box: BoxRef) => ReactNode;
}

const say = (message: string) => {
  if (Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(message);
};
/** After the change being made now has been drawn. */
const soon = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

/**
 * A list editor for past roles or studies, as on the web app. Saved entries show as a summary with Edit and Remove; a new
 * one, one being edited and one with an error show their inputs (which are folded is the form's, see useProfileDraft).
 * Done checks the entry before folding it away. The entries are saved with the rest of the profile.
 *
 * Focus follows the entry, as on the web app: into its first box when it's added or opened with Edit, onto its Edit
 * button when Done folds it, to the box with the problem when Done refuses (which a phone also says aloud), and to Add
 * when it's removed.
 */
function HistoryList({
  form: f,
  list,
  label,
  hint,
  noun,
  addLabel,
  max,
  maxNote,
  rows,
}: {
  form: ProfileDraftController;
  list: ProfileListKey;
  label: string;
  hint: string;
  noun: string;
  addLabel: string;
  max: number;
  maxNote: string;
  rows: Row[];
}) {
  // The row whose first box takes focus as its inputs appear: one just added, or opened again with Edit.
  const [opened, setOpened] = useState<string | null>(null);
  // The row whose Edit button takes focus as it appears, once Done has folded it.
  const foldedByDone = useRef<string | null>(null);
  const addButton = useRef<Focusable>(null);
  const boxes = useRef(new Map<string, TextBox>());
  const boxRef =
    (rowKey: string): BoxRef =>
    (field) =>
    (node) => {
      if (node) boxes.current.set(`${rowKey}.${field}`, node);
      else boxes.current.delete(`${rowKey}.${field}`);
    };

  const remove = (index: number, name: string) => {
    f.removeItem(list, index);
    say(`Removed ${name || `${noun.toLowerCase()} ${index + 1}`}`);
    // The button pressed is gone; Add is where the next thing to do is.
    soon(() => focusOn(addButton.current));
  };
  const done = (index: number, key: string) => {
    const problem = f.checkItem(list, index);
    if (!problem) {
      setOpened(null);
      foldedByDone.current = key;
      f.fold(key, true);
      return;
    }
    say(problem.message);
    soon(() => boxes.current.get(`${key}.${problem.field}`)?.focus());
  };

  return (
    <View role="group" aria-label={label} style={{ gap: spacing.sm }}>
      <View style={{ gap: 2 }}>
        <Text {...headingRole(3)} style={styles.heading}>
          {label}
        </Text>
        <Muted>{hint}</Muted>
      </View>
      {rows.map((row, i) => {
        const open = !f.folded.has(row.key);
        return (
          <View key={row.key} style={styles.row}>
            {open ? (
              <View role="group" aria-label={`${noun} ${i + 1}`} style={{ gap: spacing.md, padding: spacing.md }}>
                {row.editor(row.key === opened, boxRef(row.key))}
                <View style={styles.actions}>
                  <Button title="Remove" variant="ghost" accessibilityLabel={`Remove ${noun.toLowerCase()} ${i + 1}`} onPress={() => remove(i, row.name)} style={styles.small} />
                  <Button title="Done" variant="outline" accessibilityLabel={`Done with ${noun.toLowerCase()} ${i + 1}`} onPress={() => done(i, row.key)} style={styles.small} />
                </View>
              </View>
            ) : (
              <View style={styles.summary}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.title}>{row.title}</Text>
                  {row.detail ? <Text style={styles.detail}>{row.detail}</Text> : null}
                  {row.when ? <Muted>{row.when}</Muted> : null}
                </View>
                <Button
                  ref={(node) => {
                    if (node && foldedByDone.current === row.key) {
                      foldedByDone.current = null;
                      soon(() => focusOn(node));
                    }
                  }}
                  title="Edit"
                  variant="ghost"
                  accessibilityLabel={`Edit ${row.name}`}
                  onPress={() => {
                    setOpened(row.key);
                    f.fold(row.key, false);
                  }}
                  style={styles.small}
                />
                <Button title="Remove" variant="ghost" accessibilityLabel={`Remove ${row.name}`} onPress={() => remove(i, row.name)} style={styles.small} />
              </View>
            )}
          </View>
        );
      })}
      <FieldError error={f.errors[list]} />
      {rows.length < max ? (
        <Button ref={addButton} title={addLabel} variant="outline" onPress={() => setOpened(f.addItem(list))} />
      ) : (
        <Muted>{maxNote}</Muted>
      )}
    </View>
  );
}

/** A year typed on the number pad, as the batch is. */
function YearInput({ label, value, error, onChange, inputRef }: { label: string; value: string; error?: string; onChange: (v: string) => void; inputRef: (node: TextBox | null) => void }) {
  return (
    <View style={{ flex: 1 }}>
      <Input ref={inputRef} label={label} value={value} onChangeText={(v) => onChange(yearDigits(v))} keyboardType="number-pad" maxLength={4} placeholder="Year" error={error} />
    </View>
  );
}

/** Earlier jobs: title, company and years. The current one is the company and role above it. */
export function ExperienceListInput({ form: f }: { form: ProfileDraftController }) {
  const rows: Row[] = f.draft.experiences.map((e, i) => {
    const err = (k: string) => f.errors[`experiences.${i}.${k}`];
    const update = (patch: Partial<Omit<typeof e, "key">>) => f.updateItem("experiences", i, patch);
    return {
      key: e.key,
      name: e.company ? `${e.title} at ${e.company}` : e.title,
      title: e.title,
      detail: e.company || null,
      when: profileYearsLabel(Number(e.startYear) || null, Number(e.endYear) || null),
      editor: (autoFocus, box) => (
        <>
          <Input ref={box("title")} label="Job title *" value={e.title} onChangeText={(title) => update({ title })} maxLength={PROFILE_HISTORY_NAME_MAX_LENGTH} error={err("title")} autoFocus={autoFocus} />
          <Input ref={box("company")} label="Company *" value={e.company} onChangeText={(company) => update({ company })} maxLength={PROFILE_HISTORY_NAME_MAX_LENGTH} error={err("company")} />
          <View style={styles.years}>
            <YearInput inputRef={box("startYear")} label="Start year" value={e.startYear} error={err("startYear")} onChange={(startYear) => update({ startYear })} />
            <YearInput inputRef={box("endYear")} label="End year" value={e.endYear} error={err("endYear")} onChange={(endYear) => update({ endYear })} />
          </View>
        </>
      ),
    };
  });
  return (
    <HistoryList
      form={f}
      list="experiences"
      label="Past roles"
      hint="Jobs you've had before this one, newest first once saved."
      noun="Past role"
      addLabel="Add a past role"
      max={PROFILE_MAX_EXPERIENCES}
      maxNote={`You've added ${PROFILE_MAX_EXPERIENCES} past roles, the most a profile holds.`}
      rows={rows}
    />
  );
}

/** Studies anywhere other than this institution: a master's, another college, a course. */
export function EducationListInput({ form: f }: { form: ProfileDraftController }) {
  const rows: Row[] = f.draft.education.map((e, i) => {
    const err = (k: string) => f.errors[`education.${i}.${k}`];
    const update = (patch: Partial<Omit<typeof e, "key">>) => f.updateItem("education", i, patch);
    const studied = [e.degree.trim(), e.fieldOfStudy.trim()].filter(Boolean).join(", ");
    return {
      key: e.key,
      name: studied ? `${studied} at ${e.institution}` : e.institution,
      title: e.institution,
      detail: studied || null,
      when: profileYearsLabel(Number(e.startYear) || null, Number(e.endYear) || null),
      editor: (autoFocus, box) => (
        <>
          <Input ref={box("institution")} label="Institution *" value={e.institution} onChangeText={(institution) => update({ institution })} maxLength={PROFILE_HISTORY_NAME_MAX_LENGTH} error={err("institution")} autoFocus={autoFocus} />
          <Input ref={box("degree")} label="Degree" value={e.degree} onChangeText={(degree) => update({ degree })} maxLength={PROFILE_DEGREE_MAX_LENGTH} placeholder="e.g. MBA" error={err("degree")} />
          <Input ref={box("fieldOfStudy")} label="Field of study" value={e.fieldOfStudy} onChangeText={(fieldOfStudy) => update({ fieldOfStudy })} maxLength={PROFILE_DEGREE_MAX_LENGTH} error={err("fieldOfStudy")} />
          <View style={styles.years}>
            <YearInput inputRef={box("startYear")} label="Start year" value={e.startYear} error={err("startYear")} onChange={(startYear) => update({ startYear })} />
            <YearInput inputRef={box("endYear")} label="End year (or expected)" value={e.endYear} error={err("endYear")} onChange={(endYear) => update({ endYear })} />
          </View>
        </>
      ),
    };
  });
  return (
    <HistoryList
      form={f}
      list="education"
      label="Studies elsewhere"
      hint="Other universities, colleges or courses, such as a master's."
      noun="Place of study"
      addLabel="Add a place of study"
      max={PROFILE_MAX_EDUCATION}
      maxNote={`You've added ${PROFILE_MAX_EDUCATION} places of study, the most a profile holds.`}
      rows={rows}
    />
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 14, fontWeight: "700", color: colors.text },
  row: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card },
  summary: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: spacing.xs, paddingLeft: spacing.md, paddingRight: spacing.xs },
  title: { fontSize: 15, fontWeight: "600", color: colors.text },
  detail: { fontSize: 14, color: "#475569" },
  actions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: spacing.sm },
  // Still 46 points tall, narrower than a full button so a summary keeps room for its text.
  small: { paddingHorizontal: 10, minWidth: 44 },
  years: { flexDirection: "row", gap: spacing.md },
});
