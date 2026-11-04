import {
  isCurrentPupil,
  jobRangeIssues,
  referralsEnabled,
  resolveFeatures,
  type CursorPage,
  type JobCardDto,
  type JobCreateInput,
  type JobDetailDto,
  type JobDto,
  type JobListQuery,
  type JobRanges,
  type JobSeekerDto,
  type JobSeekerUpsertInput,
  type JobUpdateInput,
} from "@illuminize/shared";
import type { AppContext } from "../context";
import { toJobCardDto, toJobDto, toJobSeekerDto } from "../dto/content.dto";
import { AppError } from "../lib/errors";
import { runInTransaction } from "../lib/transaction";
import { deleteJob, deleteSeeker, findJobWithAuthor, findSeeker, insertJob, listJobs, listSeekers, lockJob, updateJob, upsertSeeker, type JobRow, type JobWithAuthor } from "../repositories/jobs.repo";
import type { TenantContext } from "../types/request";
import { afterContentWrite, assertAuthor, assertCanView, initialStatusFor, statusAfterEdit, type ContentActor, viewerOf } from "./content.common";
import { closeReferralsForJob, toJobDetail } from "./referrals/referrals.service";

const jobNotFound = () => AppError.notFound("Job not found");

/**
 * The fields copied from a job's input to its row as they are. Keyed by every input field but the two handled on their own,
 * so a field added to the schema and not here fails to compile rather than being dropped without a word.
 */
const COPIED_COLUMNS: Record<Exclude<keyof JobUpdateInput, "expiresAt" | "canRefer">, true> = {
  title: true,
  companyName: true,
  location: true,
  workMode: true,
  jobType: true,
  seniority: true,
  experienceMin: true,
  experienceMax: true,
  skills: true,
  educationRequirement: true,
  openings: true,
  description: true,
  responsibilities: true,
  requirements: true,
  benefits: true,
  howToApply: true,
  applyUrl: true,
  contactEmail: true,
  contactPhone: true,
  salaryMinMinor: true,
  salaryMaxMinor: true,
  salaryCurrency: true,
  salaryPeriod: true,
  salaryNote: true,
  companyLogoUrl: true,
  companyWebsite: true,
  companyIndustry: true,
  companySize: true,
  aboutCompany: true,
};

function jobColumns(input: JobCreateInput | JobUpdateInput) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(COPIED_COLUMNS) as Array<keyof typeof COPIED_COLUMNS>) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  if (input.expiresAt !== undefined) out.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  return out;
}

/**
 * An edit's ranges checked against what's stored, inside the lock: a PATCH of one end is checked against the other, which
 * the schema never saw. The database's own checks would only give a 500.
 */
function assertMergedRanges(before: JobRow, input: JobUpdateInput): void {
  const end = (key: keyof JobRanges) => (input[key] !== undefined ? input[key] : before[key]);
  const issues = jobRangeIssues({ experienceMin: end("experienceMin"), experienceMax: end("experienceMax"), salaryMinMinor: end("salaryMinMinor"), salaryMaxMinor: end("salaryMaxMinor") }, input);
  if (issues.length > 0) throw AppError.badRequest(issues[0]!.message, issues);
}

/**
 * Whether this member takes part in referrals here: they're on, and the member isn't a current pupil. It decides both
 * whether they're shown which jobs take requests and whether their own "I can refer" is listened to. While it's false the
 * input is ignored rather than refused, so a job posted before can still be edited.
 */
function referralsFor(tenantCtx: TenantContext, actor: ContentActor): boolean {
  return referralsEnabled(resolveFeatures(tenantCtx.tenant.type, tenantCtx.settings.features)) && !isCurrentPupil(tenantCtx.tenant, actor.membership);
}

/** Whether a viewer is told the job takes referral requests: only while they see referrals at all (`shown`), and never from a poster who is a current pupil. */
function canReferFor(tenantCtx: TenantContext, row: JobWithAuthor, shown: boolean): boolean {
  return shown && row.job.canRefer && !isCurrentPupil(tenantCtx.tenant, row.author);
}

/** A job in full as `actor` sees it. */
function jobDto(tenantCtx: TenantContext, actor: ContentActor, row: JobWithAuthor): JobDto {
  return toJobDto(row, viewerOf(actor), canReferFor(tenantCtx, row, referralsFor(tenantCtx, actor)), new Date());
}

function jobDetail(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, row: JobWithAuthor): Promise<JobDetailDto> {
  return toJobDetail(ctx.db, tenantCtx.tenant, actor.membership.id, row, jobDto(tenantCtx, actor, row));
}

export async function listTenantJobs(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: JobListQuery): Promise<CursorPage<JobCardDto>> {
  const shown = referralsFor(tenantCtx, actor);
  const viewer = viewerOf(actor);
  const page = await listJobs(ctx.db, tenantCtx.tenant, query, actor.membership.id, shown);
  return { data: page.data.map((r) => toJobCardDto(r, viewer, canReferFor(tenantCtx, r, shown))), nextCursor: page.nextCursor };
}

export async function createJob(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, input: JobCreateInput): Promise<JobDetailDto> {
  const status = initialStatusFor(tenantCtx, actor, "JOB");
  const row = await insertJob(ctx.db, {
    tenantId: tenantCtx.tenant.id,
    authorMembershipId: actor.membership.id,
    title: input.title,
    companyName: input.companyName,
    jobType: input.jobType,
    description: input.description,
    ...jobColumns(input),
    canRefer: input.canRefer === true && referralsFor(tenantCtx, actor),
    moderationStatus: status,
    moderatedAt: status === "APPROVED" ? new Date() : null,
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "JOB", id: row.id, title: row.title, status, action: "create" });
  return jobDetail(ctx, tenantCtx, actor, { job: row, author: actor.membership });
}

export async function getJob(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<JobDetailDto> {
  const found = await findJobWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw jobNotFound();
  assertCanView(actor, found.job.moderationStatus, found.job.authorMembershipId, "Job", found.author.status);
  return jobDetail(ctx, tenantCtx, actor, found);
}

export async function getJobForAdmin(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<JobDto> {
  const found = await findJobWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw jobNotFound();
  return jobDto(tenantCtx, actor, found);
}

/**
 * Edits a job. Back in review, it takes no new referral requests and keeps those waiting. Unticking "I can refer" closes those
 * waiting, in the same transaction, as closing the job would.
 */
export async function updateJobListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, input: JobUpdateInput): Promise<JobDetailDto> {
  const tenantId = tenantCtx.tenant.id;
  const offer = input.canRefer !== undefined && referralsFor(tenantCtx, actor) ? { canRefer: input.canRefer } : {};
  const row = await runInTransaction(ctx, async (tx) => {
    const before = await lockJob(tx, tenantId, id);
    if (!before) throw jobNotFound();
    assertAuthor(actor, before.authorMembershipId);
    assertMergedRanges(before, input);
    const status = statusAfterEdit(tenantCtx, actor, before.moderationStatus);
    const row = (await updateJob(tx, tenantId, id, {
      ...jobColumns(input),
      ...offer,
      moderationStatus: status,
      moderationNote: status === before.moderationStatus ? before.moderationNote : null,
    }))!;
    if (before.canRefer && !row.canRefer) await closeReferralsForJob(ctx, tx, tenantCtx.tenant, id);
    return row;
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "JOB", id, title: row.title, status: row.moderationStatus, action: "update" });
  return jobDetail(ctx, tenantCtx, actor, { job: row, author: actor.membership });
}

/** Deletes a job, closing its waiting referral requests first in the same transaction. Their rows keep what the job was called. */
export async function removeJobListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<void> {
  const tenantId = tenantCtx.tenant.id;
  const job = await runInTransaction(ctx, async (tx) => {
    const job = await lockJob(tx, tenantId, id);
    if (!job) throw jobNotFound();
    assertAuthor(actor, job.authorMembershipId);
    await closeReferralsForJob(ctx, tx, tenantCtx.tenant, id);
    await deleteJob(tx, tenantId, id);
    return job;
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "JOB", id, title: job.title, status: job.moderationStatus, action: "delete" });
}

/** Closes a job, and with it its waiting referral requests, in the same transaction. */
export async function closeJobListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<JobDetailDto> {
  const tenantId = tenantCtx.tenant.id;
  const row = await runInTransaction(ctx, async (tx) => {
    const job = await lockJob(tx, tenantId, id);
    if (!job) throw jobNotFound();
    assertAuthor(actor, job.authorMembershipId);
    const row = (await updateJob(tx, tenantId, id, { isClosed: true }))!;
    await closeReferralsForJob(ctx, tx, tenantCtx.tenant, id);
    return row;
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "JOB", id, title: row.title, status: row.moderationStatus, action: "close" });
  return jobDetail(ctx, tenantCtx, actor, { job: row, author: actor.membership });
}

// ---- seekers ----

export async function listJobSeekers(ctx: AppContext, tenantId: string, query: { cursor?: string; limit: number }): Promise<CursorPage<JobSeekerDto>> {
  const page = await listSeekers(ctx.db, tenantId, query);
  return { data: page.data.map((r) => toJobSeekerDto(r.seeker, r.member)), nextCursor: page.nextCursor };
}

export async function getMySeekerProfile(ctx: AppContext, tenantId: string, actor: ContentActor): Promise<JobSeekerDto | null> {
  const row = await findSeeker(ctx.db, tenantId, actor.membership.id);
  return row ? toJobSeekerDto(row, actor.membership) : null;
}

export async function upsertMySeekerProfile(ctx: AppContext, tenantId: string, actor: ContentActor, input: JobSeekerUpsertInput): Promise<JobSeekerDto> {
  const row = await upsertSeeker(ctx.db, {
    tenantId,
    membershipId: actor.membership.id,
    note: input.note,
    preferredRoles: input.preferredRoles ?? null,
    preferredLocations: input.preferredLocations ?? null,
    isActive: input.isActive ?? true,
  });
  return toJobSeekerDto(row, actor.membership);
}

export async function deleteMySeekerProfile(ctx: AppContext, tenantId: string, actor: ContentActor): Promise<void> {
  await deleteSeeker(ctx.db, tenantId, actor.membership.id);
}
