import { PAGE_SKELETONS } from "@illuminize/shared";
import { View } from "react-native";
import { SkeletonGroup, SkeletonLines } from "@/components/ui";
import { colors, spacing } from "@/theme";

const hairline = { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.lg };

/**
 * Stands in for a profile's details (ProfileDetails, and Message and Block with them) under its header drawn from a
 * directory card while the full profile loads (directory/[membershipId]): groups of grey lines set off by hairlines,
 * under one progressbar named "Loading", where ProfileDetails goes, as the web's.
 */
export function ProfileDetailsOutline() {
  return (
    <SkeletonGroup style={[hairline, { marginTop: spacing.xs }]}>
      <View style={{ gap: spacing.lg }}>
        {PAGE_SKELETONS.profile.sections.map((lines, row) => (
          <SkeletonLines key={row} widths={lines} row={row} style={row > 0 ? hairline : undefined} />
        ))}
      </View>
    </SkeletonGroup>
  );
}
