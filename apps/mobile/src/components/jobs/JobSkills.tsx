import { ADD_SKILLS_TO_MATCH_TEXT, YOU_HAVE_THIS_TEXT, skillMatch, skillMatchText } from "@illuminize/shared";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { IconCheck } from "@/components/icons";
import { colors, radius, spacing, useTheme } from "@/theme";

/** A member reading a job, so the skills on their profile that it asks for are marked. */
export interface SkillsViewer {
  skills: readonly string[];
  /** Opens My profile's Work section, offered when they list no skills. */
  onAddSkills: () => void;
}

/**
 * One of a job's skills on its page. One the member has is filled, bold and checked, so it never rests on colour alone. On
 * a phone the chip is one stop whose label says they have it; the web export doesn't read a label on a plain box, so there
 * the words are hidden text after the skill, as on the web app.
 */
function SkillChip({ skill, has }: { skill: string; has: boolean }) {
  const theme = useTheme();
  const said = has && Platform.OS !== "web" ? { accessible: true, accessibilityLabel: `${skill} ${YOU_HAVE_THIS_TEXT}` } : {};
  return (
    <View role="listitem" {...said} style={[styles.chip, { backgroundColor: has ? theme.primary : theme.primarySoft }]}>
      {has && <IconCheck size={14} strokeWidth={2.5} color="#fff" />}
      <Text style={[styles.chipText, has ? { color: "#fff", fontWeight: "600" } : { color: theme.primary }]}>{skill}</Text>
      {has && Platform.OS === "web" && <Text style={styles.srOnly}> {YOU_HAVE_THIS_TEXT}</Text>}
    </View>
  );
}

/**
 * A job's skills, in its order. For a `viewer`, the ones they have are marked and a line under them says how many, or, if
 * their profile lists none, offers to add theirs. Without one (the job's poster), they're only listed.
 */
export function JobSkills({ skills, viewer }: { skills: string[]; viewer?: SkillsViewer }) {
  const match = viewer && viewer.skills.length > 0 ? skillMatch(skills, viewer.skills) : null;
  const have = new Set(match?.matched);
  return (
    <View style={{ gap: spacing.xs }}>
      <View role="list" aria-label="Skills" style={styles.list}>
        {skills.map((skill) => (
          <SkillChip key={skill} skill={skill} has={have.has(skill)} />
        ))}
      </View>
      {match ? (
        <Text style={styles.line}>{skillMatchText(match)}</Text>
      ) : viewer ? (
        // A full 44-point target, quiet beside the job it's on.
        <Pressable role="link" onPress={viewer.onAddSkills} style={({ pressed }) => [styles.add, pressed ? { opacity: 0.6 } : null]}>
          <Text style={[styles.line, styles.addText]}>{ADD_SKILLS_TO_MATCH_TEXT}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%", borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { flexShrink: 1, fontSize: 12, fontWeight: "500" },
  line: { fontSize: 14, color: "#475569" },
  add: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  addText: { textDecorationLine: "underline", textDecorationColor: colors.borderStrong },
  // Read by a screen reader, unseen.
  srOnly: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
});
