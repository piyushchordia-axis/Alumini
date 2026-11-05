import { TENANT_FEATURE_LABELS, TENANT_FEATURES, featureBlockedText, toggleFeature, type TenantFeatures } from "@illuminize/shared";
import { Text, View } from "react-native";
import { Choice, FieldError } from "@/components/ui";
import { colors, spacing } from "@/theme";

/**
 * The institution's switches, one checkbox each. One that can't be turned on yet (Mentorship while Messaging is off) is
 * disabled, and says what it needs under its box, outside its name, so the name stays the switch's alone. An API refusal
 * about a switch ("features.mentorship") shows under it.
 */
export function FeatureSwitches({ features, onChange, errors }: { features: TenantFeatures; onChange: (next: TenantFeatures) => void; errors: Record<string, string> }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {TENANT_FEATURES.map((f) => {
        const blocked = featureBlockedText(features, f);
        return (
          <View key={f} style={{ gap: 4 }}>
            <Choice kind="checkbox" label={TENANT_FEATURE_LABELS[f]} checked={features[f]} disabled={!!blocked} hint={blocked ?? undefined} onPress={() => onChange(toggleFeature(features, f, !features[f]))} />
            {/* Lined up with the label, past the box. */}
            {blocked ? <Text style={{ marginLeft: 41, fontSize: 12, color: colors.muted }}>{blocked}</Text> : null}
            <FieldError error={errors[`features.${f}`]} />
          </View>
        );
      })}
    </View>
  );
}
