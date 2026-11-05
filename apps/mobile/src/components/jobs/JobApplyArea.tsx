import { applicationsClosed, applicationsLine, type JobDto } from "@illuminize/shared";
import { Text, View } from "react-native";
import { ContactButton } from "@/components/ContactButton";
import { IconEvents, IconExternalLink, IconMail, IconPhone } from "@/components/icons";
import { openLink } from "@/components/RichText";
import { colors, radius, spacing } from "@/theme";

/**
 * How to apply for a job: Apply (its link), its email and its phone, as on the web app. Once the job stops taking
 * applications they go, for everyone, and the line saying so takes their place; the API already keeps them from other
 * members by then.
 */
export function JobApplyArea({ job, now }: { job: JobDto; now: number }) {
  if (applicationsClosed(job, now)) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, backgroundColor: "#f1f5f9", paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
        <IconEvents size={16} color={colors.muted} />
        <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: "#334155" }}>{applicationsLine(job, now)}</Text>
      </View>
    );
  }
  if (!job.applyUrl && !job.contactEmail && !job.contactPhone) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {job.applyUrl && <ContactButton primary iconAfter label="Apply" text="Apply" Icon={IconExternalLink} hint="Opens the application in your browser" onPress={() => openLink(job.applyUrl!)} />}
      {job.contactEmail && <ContactButton label={`Email ${job.contactEmail}`} text={job.contactEmail} Icon={IconMail} onPress={() => openLink(`mailto:${job.contactEmail}`)} />}
      {job.contactPhone && <ContactButton label={`Call ${job.contactPhone}`} text={job.contactPhone} Icon={IconPhone} onPress={() => openLink(`tel:${job.contactPhone}`)} />}
    </View>
  );
}
