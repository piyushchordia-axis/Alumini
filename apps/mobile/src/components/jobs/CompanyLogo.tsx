import { avatarTone } from "@illuminize/shared";
import { useState } from "react";
import { Image, Text, View } from "react-native";
import { IconBuilding } from "@/components/icons";
import { initials } from "@/lib/format";
import { colors, radius } from "@/theme";

const SIZE = { sm: 44, md: 56 } as const;

/**
 * A company's logo, or its initials on a tile when it has none or the image doesn't load, in a tone from the company's
 * name (avatarTone), as on the web app. Always beside the company's name, so it's hidden from screen readers and adds
 * nothing to a card's accessible name. The address is the poster's, so the image is fetched without a referrer where the
 * platform lets us say so.
 */
export function CompanyLogo({ name, src, size = "md" }: { name: string; src: string | null | undefined; size?: keyof typeof SIZE }) {
  const [failed, setFailed] = useState<string | null>(null);
  const side = SIZE[size];
  const letters = initials(name);
  const tone = avatarTone(name);
  return (
    <View
      aria-hidden
      style={{ width: side, height: side, flexShrink: 0, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden", alignItems: "center", justifyContent: "center" }}
    >
      {src && failed !== src ? (
        <Image source={{ uri: src }} accessible={false} referrerPolicy="no-referrer" resizeMode="contain" onError={() => setFailed(src)} style={{ width: "100%", height: "100%" }} />
      ) : (
        <View style={{ width: "100%", height: "100%", backgroundColor: tone.bg, alignItems: "center", justifyContent: "center" }}>
          {letters ? <Text style={{ color: tone.fg, fontWeight: "700", fontSize: Math.round(side * 0.3) }}>{letters}</Text> : <IconBuilding size={Math.round(side * 0.45)} color={tone.fg} />}
        </View>
      )}
    </View>
  );
}
