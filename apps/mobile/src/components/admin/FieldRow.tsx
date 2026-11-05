import { fieldBadges, type ProfileFieldDto } from "@illuminize/shared";
import { Platform, Pressable, Text, View } from "react-native";
import { IconChevronDown, IconChevronUp } from "@/components/icons";
import { Badge, Button, Card } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

/** Moves a field one place, as the web console's arrows do: 44 points, named by the field, disabled at the ends. */
function ReorderButton({ label, direction, disabled, onPress }: { label: string; direction: "up" | "down"; disabled: boolean; onPress: () => void }) {
  const Icon = direction === "up" ? IconChevronUp : IconChevronDown;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Move ${label} ${direction}`}
      aria-disabled={disabled}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colors.bg : "transparent" })}
    >
      <Icon size={20} color={disabled ? colors.borderStrong : colors.text} />
    </Pressable>
  );
}

/**
 * One profile question in the console's list: its name and key, what's special about it, its options, and what can be
 * done to it. An archived one can only be restored.
 */
export function FieldRow({
  field,
  first,
  last,
  reordering,
  restoring,
  onMove,
  onEdit,
  onArchive,
  onRestore,
}: {
  field: ProfileFieldDto;
  first: boolean;
  last: boolean;
  /** A move is on its way: the arrows wait for it, so two moves can't cross. */
  reordering: boolean;
  restoring: boolean;
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const archived = !!field.archivedAt;
  return (
    <Card style={{ padding: spacing.md }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>{field.label}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 12, color: colors.muted, backgroundColor: colors.bg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>{field.key}</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {fieldBadges(field).map((b) => (
          <Badge key={b.label} label={b.label} tone={b.tone} />
        ))}
      </View>
      {field.options.length > 0 && (
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.muted }}>
          {field.options.map((o) => o.label).join(" · ")}
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        {!archived && (
          <>
            <ReorderButton label={field.label} direction="up" disabled={first || reordering} onPress={() => onMove(-1)} />
            <ReorderButton label={field.label} direction="down" disabled={last || reordering} onPress={() => onMove(1)} />
          </>
        )}
        <View style={{ flex: 1 }} />
        {archived ? (
          <Button title="Restore" variant="ghost" accessibilityLabel={`Restore ${field.label}`} loading={restoring} onPress={onRestore} />
        ) : (
          <>
            <Button title="Edit" variant="outline" accessibilityLabel={`Edit ${field.label}`} onPress={onEdit} />
            <Button title="Archive" variant="ghost" accessibilityLabel={`Archive ${field.label}`} onPress={onArchive} />
          </>
        )}
      </View>
    </Card>
  );
}
