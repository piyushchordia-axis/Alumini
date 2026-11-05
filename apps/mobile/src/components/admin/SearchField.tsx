import { Pressable, View } from "react-native";
import { IconClose } from "@/components/icons";
import { Input } from "@/components/ui";
import { colors } from "@/theme";

/** A console list's search box, with a 44-point Clear search at its end once something is typed. The API takes 80 characters. */
export function SearchField({ value, onChangeText, label, placeholder, maxLength = 80 }: { value: string; onChangeText: (text: string) => void; label: string; placeholder: string; maxLength?: number }) {
  return (
    <View>
      <Input
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        maxLength={maxLength}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        style={{ paddingRight: 44 }}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText("")}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={({ pressed }) => ({ position: "absolute", top: 0, right: 0, bottom: 0, width: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <IconClose size={18} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}
