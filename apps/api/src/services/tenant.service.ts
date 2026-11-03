import { applyFeatureChange, FEATURE_PREREQUISITES, TENANT_FEATURE_LABELS, type TenantFeatures, type TenantPublicDto, type TenantSummaryDto, type TenantType } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toTenantPublicDto, toTenantSummaryDto } from "../dto/tenant.dto";
import { AppError } from "../lib/errors";
import { keys } from "../redis/keys";
import { findTenantWithSettingsBySlug, listActiveTenants } from "../repositories/tenants.repo";
import type { TenantContext } from "../types/request";

const LIST_TTL_SEC = 60;
const TENANT_TTL_SEC = 300;

export async function listPublicTenants(ctx: AppContext, q?: string): Promise<TenantSummaryDto[]> {
  if (!q) {
    const cached = await ctx.redis.get(keys.cacheTenantsList());
    if (cached) return JSON.parse(cached) as TenantSummaryDto[];
  }
  const rows = await listActiveTenants(ctx.db, q);
  const dtos = rows.map(toTenantSummaryDto);
  if (!q) await ctx.redis.set(keys.cacheTenantsList(), JSON.stringify(dtos), "EX", LIST_TTL_SEC);
  return dtos;
}

/** Loads tenant + settings by slug with a short Redis cache. Throws TENANT_NOT_FOUND. */
export async function loadTenantContext(ctx: AppContext, slug: string): Promise<TenantContext> {
  const cacheKey = keys.cacheTenant(slug);
  const cached = await ctx.redis.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached) as { tenant: Record<string, unknown>; settings: Record<string, unknown> };
    return reviveTenantContext(parsed);
  }
  const row = await findTenantWithSettingsBySlug(ctx.db, slug);
  if (!row) throw AppError.notFound("Institution not found", "TENANT_NOT_FOUND");
  await ctx.redis.set(cacheKey, JSON.stringify(row), "EX", TENANT_TTL_SEC);
  return row;
}

export async function getPublicTenant(ctx: AppContext, slug: string): Promise<TenantPublicDto> {
  const { tenant, settings } = await loadTenantContext(ctx, slug);
  if (tenant.status !== "ACTIVE") throw AppError.notFound("Institution not found", "TENANT_NOT_FOUND");
  return toTenantPublicDto(tenant, settings);
}

export async function invalidateTenantCache(ctx: AppContext, slug: string): Promise<void> {
  await ctx.redis.del(keys.cacheTenant(slug), keys.cacheTenantsList());
}

/** The feature map to store after `change`. Refuses the change (400) if it turns a key on that may not be on. */
export function featuresToStore(type: TenantType, stored: Partial<TenantFeatures>, change: Partial<TenantFeatures>): TenantFeatures {
  const { features, conflict } = applyFeatureChange(type, stored, change);
  if (conflict) {
    const needs = FEATURE_PREREQUISITES[conflict];
    const message = needs ? `${TENANT_FEATURE_LABELS[conflict]} needs ${TENANT_FEATURE_LABELS[needs]}. Turn on ${TENANT_FEATURE_LABELS[needs]} first.` : `${TENANT_FEATURE_LABELS[conflict]} can't be turned on here`;
    throw AppError.badRequest(message, [{ path: `features.${conflict}`, message }]);
  }
  return features;
}

const DATE_FIELDS = ["createdAt", "updatedAt", "lastLoginAt", "statusChangedAt", "lastActiveAt"] as const;

function reviveDates<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj };
  for (const f of DATE_FIELDS) {
    if (typeof out[f] === "string") out[f] = new Date(out[f] as string);
  }
  return out as T;
}

function reviveTenantContext(parsed: { tenant: Record<string, unknown>; settings: Record<string, unknown> }): TenantContext {
  return {
    tenant: reviveDates(parsed.tenant) as unknown as TenantContext["tenant"],
    settings: reviveDates(parsed.settings) as unknown as TenantContext["settings"],
  };
}
