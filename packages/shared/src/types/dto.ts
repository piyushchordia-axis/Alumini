import type {
  ApprovalMode,
  MembershipRole,
  MembershipStatus,
  TenantFeatures,
  TenantStatus,
  TenantType,
} from "../constants";
import type { ErrorCode } from "../errorCodes";

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TenantSummaryDto {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  type: TenantType;
  city: string | null;
  country: string | null;
  logoUrl: string | null;
  primaryColor: string;
}

export interface TenantPublicSettings {
  memberApprovalMode: ApprovalMode;
  allowSelfRegistration: boolean;
  minBatchYear: number;
  maxBatchYear: number;
  features: TenantFeatures;
}

export interface TenantPublicDto extends TenantSummaryDto {
  status: TenantStatus;
  coverImageUrl: string | null;
  secondaryColor: string;
  tagline: string | null;
  welcomeMessage: string | null;
  websiteUrl: string | null;
  settings: TenantPublicSettings;
}

export interface TenantSettingsDto {
  memberApprovalMode: ApprovalMode;
  contentModerationMode: ApprovalMode;
  allowSelfRegistration: boolean;
  minBatchYear: number;
  maxBatchYear: number;
  features: TenantFeatures;
  updatedAt: string;
}

export type OtpChannel = "whatsapp" | "sms" | "console";

export interface OtpRequestResultDto {
  expiresInSec: number;
  resendAfterSec: number;
  channel: OtpChannel;
  /** Only present when the API runs in development mode. */
  devCode?: string;
}

export interface UserDto {
  id: string;
  phone: string;
  displayName: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
}

export interface MembershipSummaryDto {
  id: string;
  tenant: TenantSummaryDto;
  role: MembershipRole;
  status: MembershipStatus;
  statusReason: string | null;
  fullName: string;
  batchYear: number;
  avatarUrl: string | null;
}

export interface MeDto {
  user: UserDto;
  memberships: MembershipSummaryDto[];
}

export interface AuthSessionDto extends MeDto {
  accessToken: string;
  refreshToken: string;
}

export interface TokenPairDto {
  accessToken: string;
  refreshToken: string;
}
