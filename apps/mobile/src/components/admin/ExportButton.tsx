import { errorMessage } from "@illuminize/shared/client";
import { useMutation } from "@tanstack/react-query";
import { StyleSheet, View } from "react-native";
import { IconDownload } from "@/components/icons";
import { Button } from "@/components/ui";
import { saveFile } from "@/lib/files";
import { spacing } from "@/theme";

/** One CSV export: its button's label, and how to fetch it as text. */
export interface CsvExport {
  label: string;
  run: () => Promise<{ text: string; filename: string | null }>;
}

/**
 * A button for each CSV export, saving the file through saveFile, which puts its byte order mark back (so Excel reads
 * names in any script) and opens the share sheet on a phone. One export runs at a time: the pressed button says
 * "Preparing…" until the file is handed over, and the others wait, because saveFile keeps only the latest file (it
 * deletes the one before, which an open sheet may still be offering) and a phone shares one file at a time. Closing the
 * sheet without saving is not a failure. `onError` hears what went wrong (the API's words, such as the hourly limit),
 * and null when the next try starts, for a line the screen shows under the buttons.
 */
export function ExportButtons({ exports, onError }: { exports: readonly CsvExport[]; onError: (message: string | null) => void }) {
  const exported = useMutation({
    mutationFn: async (e: CsvExport) => {
      const { text, filename } = await e.run();
      await saveFile(filename ?? "export.csv", text, "text/csv");
    },
    onMutate: () => onError(null),
    onError: (err) => onError(errorMessage(err, "The export failed. Try again.")),
  });
  return (
    <View style={styles.row}>
      {exports.map((e) => {
        const preparing = exported.isPending && exported.variables?.label === e.label;
        return (
          <Button
            key={e.label}
            title={preparing ? "Preparing…" : e.label}
            variant="outline"
            size="compact"
            disabled={exported.isPending}
            aria-busy={preparing}
            icon={(c) => <IconDownload size={18} color={c} />}
            onPress={() => exported.mutate(e)}
            style={{ flexGrow: 1 }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
