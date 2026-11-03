import { pgEnum } from "drizzle-orm/pg-core";
import {
  APPROVAL_MODES,
  BILLING_CYCLES,
  BILLING_MODELS,
  BUSINESS_CATEGORIES,
  CHAT_CONVERSATION_KINDS,
  CHAT_DIRECT_STATES,
  CHAT_GROUP_VISIBILITIES,
  CHAT_MESSAGE_KINDS,
  CHAT_ORIGINS,
  CHAT_PARTICIPANT_ROLES,
  CHAT_PARTICIPANT_STATES,
  CHAT_REPORT_ACTIONS,
  CHAT_REPORT_TARGET_KINDS,
  CONTENT_TYPES,
  EVENT_KINDS,
  FUNDING_KINDS,
  FUNDING_STAGES,
  INVITATION_STATUSES,
  JOB_TYPES,
  MARITAL_STATUSES,
  MEMBERSHIP_ROLES,
  MENTOR_AREAS,
  MENTOR_AVAILABILITIES,
  MENTORSHIP_STATUSES,
  MESSAGE_CHANNELS,
  MEMBERSHIP_STATUSES,
  MODERATION_STATUSES,
  NOTIFICATION_TYPES,
  PROFESSION_TYPES,
  PROFILE_FIELD_TYPES,
  PROFILE_FIELD_VISIBILITIES,
  OUTBOUND_MESSAGE_STATUSES,
  PAYMENT_ORDER_STATUSES,
  PAYMENT_PURPOSES,
  PAYMENT_REFUND_STATUSES,
  POST_KINDS,
  PUSH_PLATFORMS,
  REACTION_TYPES,
  REFERRAL_STATUSES,
  REPORT_REASONS,
  REPORT_STATUSES,
  RSVP_STATUSES,
  TENANT_STATUSES,
  TENANT_TYPES,
} from "@illuminize/shared";

export const tenantTypeEnum = pgEnum("tenant_type", TENANT_TYPES);
export const tenantStatusEnum = pgEnum("tenant_status", TENANT_STATUSES);
export const approvalModeEnum = pgEnum("approval_mode", APPROVAL_MODES);
export const membershipRoleEnum = pgEnum("membership_role", MEMBERSHIP_ROLES);
export const membershipStatusEnum = pgEnum("membership_status", MEMBERSHIP_STATUSES);
export const professionTypeEnum = pgEnum("profession_type", PROFESSION_TYPES);
export const maritalStatusEnum = pgEnum("marital_status", MARITAL_STATUSES);
export const moderationStatusEnum = pgEnum("moderation_status", MODERATION_STATUSES);
export const jobTypeEnum = pgEnum("job_type", JOB_TYPES);
export const fundingKindEnum = pgEnum("funding_kind", FUNDING_KINDS);
export const fundingStageEnum = pgEnum("funding_stage", FUNDING_STAGES);
export const businessCategoryEnum = pgEnum("business_category", BUSINESS_CATEGORIES);
export const eventKindEnum = pgEnum("event_kind", EVENT_KINDS);
export const rsvpStatusEnum = pgEnum("rsvp_status", RSVP_STATUSES);
export const reactionTypeEnum = pgEnum("reaction_type", REACTION_TYPES);
export const contentTypeEnum = pgEnum("content_type", CONTENT_TYPES);
export const reportReasonEnum = pgEnum("report_reason", REPORT_REASONS);
export const reportStatusEnum = pgEnum("report_status", REPORT_STATUSES);
export const notificationTypeEnum = pgEnum("notification_type", NOTIFICATION_TYPES);
export const billingModelEnum = pgEnum("billing_model", BILLING_MODELS);
export const billingCycleEnum = pgEnum("billing_cycle", BILLING_CYCLES);
export const pushPlatformEnum = pgEnum("push_platform", PUSH_PLATFORMS);
export const messageChannelEnum = pgEnum("message_channel", MESSAGE_CHANNELS);
export const outboundMessageStatusEnum = pgEnum("outbound_message_status", OUTBOUND_MESSAGE_STATUSES);
export const paymentPurposeEnum = pgEnum("payment_purpose", PAYMENT_PURPOSES);
export const paymentOrderStatusEnum = pgEnum("payment_order_status", PAYMENT_ORDER_STATUSES);
export const paymentRefundStatusEnum = pgEnum("payment_refund_status", PAYMENT_REFUND_STATUSES);
export const profileFieldTypeEnum = pgEnum("profile_field_type", PROFILE_FIELD_TYPES);
export const profileFieldVisibilityEnum = pgEnum("profile_field_visibility", PROFILE_FIELD_VISIBILITIES);
export const invitationStatusEnum = pgEnum("invitation_status", INVITATION_STATUSES);
export const postKindEnum = pgEnum("post_kind", POST_KINDS);
export const chatConversationKindEnum = pgEnum("chat_conversation_kind", CHAT_CONVERSATION_KINDS);
export const chatOriginEnum = pgEnum("chat_origin", CHAT_ORIGINS);
export const chatDirectStateEnum = pgEnum("chat_direct_state", CHAT_DIRECT_STATES);
export const chatParticipantStateEnum = pgEnum("chat_participant_state", CHAT_PARTICIPANT_STATES);
export const chatParticipantRoleEnum = pgEnum("chat_participant_role", CHAT_PARTICIPANT_ROLES);
export const chatMessageKindEnum = pgEnum("chat_message_kind", CHAT_MESSAGE_KINDS);
export const chatReportTargetKindEnum = pgEnum("chat_report_target_kind", CHAT_REPORT_TARGET_KINDS);
export const chatReportActionEnum = pgEnum("chat_report_action", CHAT_REPORT_ACTIONS);
export const chatGroupVisibilityEnum = pgEnum("chat_group_visibility", CHAT_GROUP_VISIBILITIES);
export const mentorAreaEnum = pgEnum("mentor_area", MENTOR_AREAS);
export const mentorAvailabilityEnum = pgEnum("mentor_availability", MENTOR_AVAILABILITIES);
export const mentorshipStatusEnum = pgEnum("mentorship_status", MENTORSHIP_STATUSES);
export const referralStatusEnum = pgEnum("referral_status", REFERRAL_STATUSES);
