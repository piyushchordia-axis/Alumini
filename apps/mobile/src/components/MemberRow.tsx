import type { MemberCardDto } from "@illuminize/shared";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Avatar, Muted } from "@/components/ui";
import { colors } from "@/theme";

export function MemberRow({ slug, member, meta, size = 36 }: { slug: string; member: MemberCardDto; meta?: string; size?: number }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(`/t/${slug}/directory/${member.id}`)} accessibilityRole="link" accessibilityLabel={`${member.fullName}${meta ? `, ${meta}` : ""}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
      <Avatar name={member.fullName} src={member.avatarUrl} size={size} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "600", color: colors.text }} numberOfLines={1}>
          {member.fullName}
        </Text>
        <Muted>{meta ?? `Batch of ${member.batchYear}${member.companyName ? ` · ${member.companyName}` : ""}`}</Muted>
      </View>
    </Pressable>
  );
}
