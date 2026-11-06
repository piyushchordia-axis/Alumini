import { memberYearsLine, type MemberCardDto } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Avatar } from "@/components/ui";
import { colors } from "@/theme";

/**
 * A member's photo and name, linking to their profile, with `meta` under the name. Without it, their headline, or else
 * their years and company. The line stays one line, so a long headline doesn't make the row taller.
 */
export function MemberRow({ slug, member, meta, size = 36 }: { slug: string; member: MemberCardDto; meta?: string; size?: number }) {
  const router = useRouter();
  const line = meta ?? member.headline ?? memberYearsLine(member, member.companyName);
  return (
    <Pressable onPress={() => router.push(`/t/${slug}/directory/${member.id}`)} accessibilityRole="link" accessibilityLabel={`${member.fullName}, ${line}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
      <Avatar name={member.fullName} src={member.avatarUrl} size={size} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "600", color: colors.text }} numberOfLines={1}>
          {member.fullName}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
          {line}
        </Text>
      </View>
    </Pressable>
  );
}
