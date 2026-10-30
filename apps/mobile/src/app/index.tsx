import { ERROR_CODES } from "@illuminize/shared";
import { StyleSheet, Text, View } from "react-native";

export default function IndexScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Illuminize</Text>
      <Text style={styles.subtitle}>Scaffold ready. {ERROR_CODES.length} error codes shared.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "600", color: "#1d4ed8" },
  subtitle: { marginTop: 8, color: "#475569" },
});
