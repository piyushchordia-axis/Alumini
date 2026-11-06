import { memberFacts, uuidSchema } from "@illuminize/shared";
import { fatalQueryError, isApiClientError } from "@illuminize/shared/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import { RefreshControl, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { AdminFieldAnswers } from "@/components/admin/AdminFieldAnswers";
import { AdminScreen } from "@/components/admin/AdminScreen";
import { AuditRow } from "@/components/admin/AuditRow";
import { MemberActionButtons } from "@/components/admin/MemberActionButtons";
import { MemberFacts, MentorProfileCard, RoleChangeButton } from "@/components/admin/MemberDetail";
import { MemberStatusBadge } from "@/components/admin/MemberStatusBadge";
import { IconDirectory } from "@/components/icons";
import { ProfileDetails, ProfileSummary } from "@/components/profile/ProfileDetails";
import { StatusLine } from "@/components/Sheet";
import { Badge, Button, Card, EmptyState, ErrorText, Muted, Spinner, headingRole } from "@/components/ui";
import { useMemberActions, type MemberActionOutcome } from "@/hooks/useMemberActions";
import { useMembership } from "@/hooks/useMembership";
import { useStatus } from "@/hooks/useStatus";
import { adminHomeHref, adminMemberHref, adminSectionHref } from "@/lib/admin";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { qk } from "@/lib/queryKeys";
import { colors, spacing, useTheme } from "@/theme";

export default function AdminMemberScreen() {
  const { membershipId = "" } = useLocalSearchParams<{ membershipId: string }>();
  // Keyed, so nothing typed or asked about one member carries into the next.
  return <AdminMember key={membershipId} id={membershipId} />;
}

function Divider() {
  return <View style={styles.divider} />;
}

/**
 * A member as the console shows them (the web console's member page): who they are, what can be done (their status, and
 * the admin role for an approved member), the facts their profile doesn't show, their profile, their answers to the
 * institution's questions, their mentor profile, and the latest of what they did and what was done to them.
 */
function AdminMember({ id }: { id: string }) {
  const { tenant, membership: me } = useMembership();
  const slug = tenant.slug;
  const router = useRouter();
  const qc = useQueryClient();
  const theme = useTheme();
  // Checked before asking, as the address can carry anything.
  const valid = uuidSchema.safeParse(id).success;
  const query = useQuery({ queryKey: qk.admin.member(slug, id), queryFn: () => api.admin.members.get(slug, id), enabled: valid });
  const [said, say] = useStatus<MemberActionOutcome>();
  const actions = useMemberActions(slug, say);
  const scroller = useRef<ScrollViewInstance>(null);
  const answersCard = useRef<ComponentRef<typeof View>>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([query.refetch(), qc.invalidateQueries({ queryKey: qk.admin.profileFields(slug) })]);
    } finally {
      setRefreshing(false);
    }
  };
  /** Brings the answers editor into view once it has opened, measured where the card is now. */
  const showAnswers = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const content = scroller.current?.getInnerViewRef();
        if (content && answersCard.current) answersCard.current.measureLayout(content, (_x, y) => scroller.current?.scrollTo({ y: Math.max(0, y - spacing.sm), animated: true }));
      }),
    );

  const error = fatalQueryError(query);
  const m = query.data;
  if (!valid || (isApiClientError(error) && error.status === 404)) {
    return (
      <AdminScreen title="Member">
        <EmptyState icon={<IconDirectory size={32} color={colors.faint} />} title="This member isn't here" description="They may have deleted their account, or the link is wrong." />
        <Button title="Back to members" variant="outline" accessibilityRole="link" onPress={() => router.dismissTo(adminSectionHref(slug, "members") ?? adminHomeHref(slug))} />
      </AdminScreen>
    );
  }
  if (!m) {
    return (
      <AdminScreen title="Member">
        {error ? (
          <>
            <ErrorText error={error} />
            <Button title="Try again" variant="outline" onPress={() => void query.refetch()} />
          </>
        ) : (
          <Spinner label="Loading member" />
        )}
      </AdminScreen>
    );
  }

  const isSelf = m.id === me.id;
  return (
    <AdminScreen title={m.fullName} scrollRef={scroller} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.primary} colors={[theme.primary]} />}>
      <Card style={{ gap: spacing.lg }}>
        <ProfileSummary
          profile={{ ...m, isMentor: !!m.mentorProfile?.isActive }}
          nameExtras={
            <>
              <MemberStatusBadge status={m.status} />
              {m.role === "TENANT_ADMIN" && <Badge label="Admin" tone="primary" />}
            </>
          }
        >
          {m.statusReason ? <Text style={styles.reason}>Reason: {m.statusReason}</Text> : null}
          <View style={styles.actions}>
            {isSelf ? (
              <Text style={styles.you}>This is you.</Text>
            ) : (
              <>
                <MemberActionButtons member={m} actions={actions} />
                {m.status === "APPROVED" && <RoleChangeButton slug={slug} member={m} tenantName={tenant.name} say={say} />}
              </>
            )}
          </View>
        </ProfileSummary>
        <StatusLine text={said?.text ?? null} tone={said?.tone} flush />
        <Divider />
        <MemberFacts facts={memberFacts(m, { formatDate, formatDateTime })} />
        <ProfileDetails profile={m} tenant={tenant} style={styles.details} />
        {m.status === "APPROVED" && tenant.settings.features.directory && (
          // Out of the console, down to the tabs under it, rather than a second set of tabs on top of it.
          <Button title="View profile in the app" variant="outline" accessibilityRole="link" onPress={() => router.dismissTo(`/t/${slug}/directory/${m.id}`)} />
        )}
      </Card>
      <AdminFieldAnswers slug={slug} member={m} onEdit={showAnswers} cardRef={answersCard} />
      {m.mentorProfile && <MentorProfileCard slug={slug} membershipId={m.id} profile={m.mentorProfile} />}
      <Text {...headingRole(2)} style={styles.heading}>
        Recent activity
      </Text>
      <Card style={styles.activity}>
        {m.audit.length === 0 ? (
          <View style={{ padding: spacing.lg }}>
            <Muted size={13}>No activity yet.</Muted>
          </View>
        ) : (
          m.audit.map((entry, i) => (
            <View key={entry.id}>
              {i > 0 && <Divider />}
              <AuditRow entry={entry} selfId={m.id} onOpenMember={(other) => router.push(adminMemberHref(slug, other))} />
            </View>
          ))
        )}
      </Card>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  reason: { fontSize: 14, color: colors.muted, textAlign: "center", marginTop: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm, marginTop: spacing.sm },
  you: { fontSize: 13, color: colors.muted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  details: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.lg },
  heading: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: spacing.xs },
  activity: { padding: 0, gap: 0, overflow: "hidden" },
});
