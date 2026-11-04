import type { MembershipDto, MembershipProfileInput, ProfileFieldDto, TenantPublicDto } from "@illuminize/shared";
import { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { ProfileAboutSection, ProfileBasicsSection, ProfileWorkSection } from "@/components/profile/ProfileSections";
import { useProfileDraft } from "@/components/profile/useProfileDraft";
import type { SkillsInputHandle } from "@/components/SkillsInput";
import { Button, ErrorText, headingRole } from "@/components/ui";
import { colors, useTheme } from "@/theme";

/**
 * A member's profile on one page, as registration asks for it: Basics, then Work, then About you behind "More about you
 * (optional)". Name and batch stay the first two inputs. Editing lays the same sections out as cards (profile/edit).
 */
export function ProfileForm({
  tenant,
  initial,
  submitLabel,
  onSubmit,
  customFields = [],
  mode = "register",
}: {
  tenant: TenantPublicDto;
  initial?: Partial<MembershipDto>;
  submitLabel: string;
  onSubmit: (v: MembershipProfileInput) => Promise<void>;
  /** The institution's own questions (api.membership.profileFields). */
  customFields?: ProfileFieldDto[];
  mode?: "register" | "edit";
}) {
  const theme = useTheme();
  const skillsRef = useRef<SkillsInputHandle>(null);
  const f = useProfileDraft({ tenant, initial, customFields, mode, onSubmit, skillsRef });
  return (
    <View style={{ gap: 14 }}>
      <ProfileBasicsSection form={f} />
      <View style={{ gap: 14, marginTop: 6 }}>
        <Text {...headingRole(2)} style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>
          Work <Text style={{ fontWeight: "400", color: colors.muted }}>(optional)</Text>
        </Text>
        <ProfileWorkSection form={f} skillsRef={skillsRef} />
      </View>
      <Pressable onPress={() => f.setMoreOpen((m) => !m)} accessibilityRole="button" aria-expanded={f.moreOpen} style={{ minHeight: 44, justifyContent: "center" }}>
        <Text style={{ color: theme.primary, fontWeight: "600" }}>{f.moreOpen ? "Hide optional details" : "More about you (optional)"}</Text>
      </Pressable>
      {f.moreOpen && <ProfileAboutSection form={f} />}
      <ErrorText error={f.serverError} />
      {f.photoBusy && <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>Wait for the photo to finish uploading.</Text>}
      <Button title={submitLabel} onPress={() => void f.submit()} loading={f.busy} disabled={f.photoBusy} />
    </View>
  );
}
