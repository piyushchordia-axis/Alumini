import type { JobDetailDto, ReferralDto } from "@illuminize/shared";
import request from "supertest";
import type { Session } from "./chat";
import type { TestContext } from "./testContext";

export const REFERRAL_JOB = { title: "Backend Engineer", companyName: "Acme", location: "Mumbai", jobType: "FULL_TIME", description: "Build services with Node.js and Postgres.", canRefer: true };
export const REFERRAL_NOTE = "I've built payment services in Node for three years. Could you refer me for this role?";

/** The jobs and referral routes of one institution, as one member. */
export function referralsApi(ctx: TestContext, slug: string, member: Pick<Session, "headers">) {
  const url = (path: string) => `/api/v1/t/${slug}/jobs${path}`;
  const api = () => request(ctx.app);
  const action = (name: string) => (id: string) => api().post(url(`/referrals/${id}/${name}`)).set(member.headers).send();
  return {
    postJob: (body: Record<string, unknown> = {}) => api().post(url("")).set(member.headers).send({ ...REFERRAL_JOB, ...body }),
    jobs: (query: Record<string, unknown> = {}) => api().get(url("")).query(query).set(member.headers),
    job: (id: string) => api().get(url(`/${id}`)).set(member.headers),
    editJob: (id: string, body: Record<string, unknown>) => api().patch(url(`/${id}`)).set(member.headers).send(body),
    closeJob: (id: string) => api().post(url(`/${id}/close`)).set(member.headers).send(),
    deleteJob: (id: string) => api().delete(url(`/${id}`)).set(member.headers),
    request: (jobId: string, note = REFERRAL_NOTE) => api().post(url(`/${jobId}/referrals`)).set(member.headers).send({ note }),
    forJob: (jobId: string, query: Record<string, unknown> = {}) => api().get(url(`/${jobId}/referrals`)).query(query).set(member.headers),
    mine: (box: "received" | "sent" = "received", query: Record<string, unknown> = {}) => api().get(url("/referrals/mine")).query({ box, ...query }).set(member.headers),
    summary: () => api().get(url("/referrals/summary")).set(member.headers),
    accept: action("accept"),
    decline: action("decline"),
    withdraw: action("withdraw"),
    report: (id: string, body: Record<string, unknown> = { reason: "HARASSMENT" }) => api().post(url(`/referrals/${id}/report`)).set(member.headers).send(body),
  };
}

/** Posts a job whose poster can refer people, failing the test if it can't. */
export async function postReferralJob(ctx: TestContext, slug: string, poster: Session, body: Record<string, unknown> = {}): Promise<JobDetailDto> {
  const res = await referralsApi(ctx, slug, poster).postJob(body);
  if (res.status !== 201) throw new Error(`POST /jobs failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as JobDetailDto;
}

/** Asks for a referral and returns the request as its sender sees it. */
export async function askForReferral(ctx: TestContext, slug: string, requester: Session, jobId: string, note = REFERRAL_NOTE): Promise<ReferralDto> {
  const res = await referralsApi(ctx, slug, requester).request(jobId, note);
  if (res.status !== 201) throw new Error(`POST /jobs/:id/referrals failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as ReferralDto;
}

/** A referral the poster accepted, on a job of their own. Returns the job and the request as the poster sees it. */
export async function acceptedReferral(ctx: TestContext, slug: string, poster: Session, requester: Session, note = REFERRAL_NOTE): Promise<{ job: JobDetailDto; referral: ReferralDto }> {
  const job = await postReferralJob(ctx, slug, poster);
  const asked = await askForReferral(ctx, slug, requester, job.id, note);
  const res = await referralsApi(ctx, slug, poster).accept(asked.id);
  if (res.status !== 200) throw new Error(`accept failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { job, referral: res.body.data as ReferralDto };
}

/** The parts of a request's DTO that differ between two requests for no reason its sender could act on, so two can be compared. */
export function comparableReferral(dto: ReferralDto) {
  const at = (v: string | null) => v && "<at>";
  return {
    ...dto,
    id: "<id>",
    job: { ...dto.job, id: dto.job.id && "<id>", title: "<title>" },
    member: dto.member && { ...dto.member, id: "<id>", fullName: "<name>" },
    createdAt: "<at>",
    respondedAt: at(dto.respondedAt),
    acceptedAt: at(dto.acceptedAt),
    closedAt: at(dto.closedAt),
  };
}
