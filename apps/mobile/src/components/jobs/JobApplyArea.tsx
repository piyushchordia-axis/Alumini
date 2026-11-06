import { NO_JOB_CONTACTS_TEXT, applicationsClosed, applicationsLine, jobContactRows, type JobContactRow, type JobDto } from "@illuminize/shared";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { ContactButton } from "@/components/ContactButton";
import { IconEvents, IconExternalLink, IconMail, IconPhone, type IconProps } from "@/components/icons";
import { openLink } from "@/components/RichText";
import { colors, radius, spacing } from "@/theme";

const CONTACT_ICONS: Record<JobContactRow["key"], (p: IconProps) => ReactElement> = { applyUrl: IconExternalLink, contactEmail: IconMail, contactPhone: IconPhone };

/**
 * How to apply for a job: Apply (its link), its email and its phone, as on the web app. Once the job stops taking
 * applications they go, for everyone, and the line saying so takes their place; the API already keeps them from other
 * members by then.
 *
 * `plain` is the admin's preview: the contacts as text that can be selected, never something to tap, whether the job is
 * open or not, so an admin reads where they lead without following them.
 */
export function JobApplyArea({ job, now, plain = false }: { job: JobDto; now: number; plain?: boolean }) {
  const ended = applicationsClosed(job, now);
  const closedLine = ended ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radius.md, backgroundColor: "#f1f5f9", paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
      <IconEvents size={16} color={colors.muted} />
      <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: "#334155" }}>{applicationsLine(job, now)}</Text>
    </View>
  ) : null;

  if (plain) {
    const rows = jobContactRows(job);
    return (
      <View style={{ gap: spacing.sm }}>
        {closedLine}
        {rows.length > 0 ? (
          rows.map(({ key, label, value }) => {
            const Icon = CONTACT_ICONS[key];
            return (
              <View key={key} style={{ flexDirection: "row", gap: spacing.sm }}>
                <View style={{ paddingTop: 2 }}>
                  <Icon size={16} color={colors.faint} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
                  <Text selectable style={{ fontSize: 14, color: colors.text }}>
                    {value}
                  </Text>
                </View>
              </View>
            );
          })
        ) : (
          <Text style={{ fontSize: 14, color: colors.muted }}>{NO_JOB_CONTACTS_TEXT}</Text>
        )}
      </View>
    );
  }

  if (closedLine) return closedLine;
  if (!job.applyUrl && !job.contactEmail && !job.contactPhone) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {job.applyUrl && <ContactButton primary iconAfter label="Apply" text="Apply" Icon={IconExternalLink} hint="Opens the application in your browser" onPress={() => openLink(job.applyUrl!)} />}
      {job.contactEmail && <ContactButton label={`Email ${job.contactEmail}`} text={job.contactEmail} Icon={IconMail} onPress={() => openLink(`mailto:${job.contactEmail}`)} />}
      {job.contactPhone && <ContactButton label={`Call ${job.contactPhone}`} text={job.contactPhone} Icon={IconPhone} onPress={() => openLink(`tel:${job.contactPhone}`)} />}
    </View>
  );
}
