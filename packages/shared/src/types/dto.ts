import type { ApprovalMode, TenantFeatures, TenantStatus, TenantType } from "../constants";
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
