import type { MentorProfileUpsertInput, MentorshipDto } from "@illuminize/shared";
import request from "supertest";
import type { Session } from "./chat";
import type { TestContext } from "./testContext";

export const MENTOR_PROFILE: MentorProfileUpsertInput = { areas: ["CAREER_ADVICE", "SOFTWARE_IT"], availability: "MONTHLY", availabilityNote: "Weekday evenings", note: "Happy to talk about moving into software." };
export const NOTE = "Could you help me plan a move from support into software engineering?";

/** The mentorship routes of one institution, as one member. */
export function mentorshipApi(ctx: TestContext, slug: string, member: Pick<Session, "headers">) {
  const url = (path: string) => `/api/v1/t/${slug}/mentorship${path}`;
  const api = () => request(ctx.app);
  const action = (name: string) => (id: string) => api().post(url(`/requests/${id}/${name}`)).set(member.headers).send();
  return {
    me: () => api().get(url("/me")).set(member.headers),
    save: (body: Record<string, unknown> = MENTOR_PROFILE as Record<string, unknown>) => api().put(url("/me")).set(member.headers).send(body),
    stop: () => api().delete(url("/me")).set(member.headers),
    summary: () => api().get(url("/summary")).set(member.headers),
    mentors: (query: Record<string, unknown> = {}) => api().get(url("/mentors")).query(query).set(member.headers),
    mentor: (membershipId: string) => api().get(url(`/mentors/${membershipId}`)).set(member.headers),
    request: (mentorMembershipId: string, note = NOTE) => api().post(url("/requests")).set(member.headers).send({ mentorMembershipId, note }),
    requests: (box: "received" | "sent" = "received", query: Record<string, unknown> = {}) => api().get(url("/requests")).query({ box, ...query }).set(member.headers),
    accept: action("accept"),
    decline: action("decline"),
    withdraw: action("withdraw"),
    end: action("end"),
    report: (id: string, body: Record<string, unknown> = { reason: "HARASSMENT" }) => api().post(url(`/requests/${id}/report`)).set(member.headers).send(body),
  };
}

/** Offers to mentor, failing the test if it can't. */
export async function offerToMentor(ctx: TestContext, slug: string, mentor: Session, profile: Record<string, unknown> = MENTOR_PROFILE as Record<string, unknown>): Promise<void> {
  const res = await mentorshipApi(ctx, slug, mentor).save(profile);
  if (res.status !== 200) throw new Error(`PUT /mentorship/me failed: ${res.status} ${JSON.stringify(res.body)}`);
}

/** Asks a mentor and returns the request as its mentee sees it. */
export async function askMentor(ctx: TestContext, slug: string, mentee: Session, mentorMembershipId: string, note = NOTE): Promise<MentorshipDto> {
  const res = await mentorshipApi(ctx, slug, mentee).request(mentorMembershipId, note);
  if (res.status !== 201) throw new Error(`POST /mentorship/requests failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as MentorshipDto;
}

/** A mentorship under way: the mentor offered, the mentee asked and the mentor accepted. Returns it as the mentor sees it. */
export async function acceptedMentorship(ctx: TestContext, slug: string, mentor: Session, mentee: Session, note = NOTE): Promise<MentorshipDto> {
  await offerToMentor(ctx, slug, mentor);
  const asked = await askMentor(ctx, slug, mentee, mentor.membership.id, note);
  const res = await mentorshipApi(ctx, slug, mentor).accept(asked.id);
  if (res.status !== 200) throw new Error(`accept failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as MentorshipDto;
}

/** The parts of a request's DTO that differ between two requests for no reason its sender could act on, so two can be compared. */
export function comparableMentorship(dto: MentorshipDto) {
  const at = (v: string | null) => v && "<at>";
  return { ...dto, id: "<id>", member: dto.member && { ...dto.member, id: "<id>", fullName: "<name>" }, createdAt: "<at>", respondedAt: at(dto.respondedAt), acceptedAt: at(dto.acceptedAt), endedAt: at(dto.endedAt) };
}
