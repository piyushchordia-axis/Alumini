import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import request from "supertest";
import type { ChatConversationDto, ChatDirectResultDto, ChatGroupDto, ChatMessageDto } from "@illuminize/shared";
import { chatConversations, chatParticipants } from "../../src/db/schema";
import { runInTransaction } from "../../src/lib/transaction";
import { lockConversation, type ChatMessageRow } from "../../src/repositories/chat.repo";
import { appendMessage } from "../../src/services/chat/fanout";
import { createMembership, createUser, type memberSession } from "./factories";
import type { TestContext } from "./testContext";

export type Session = Awaited<ReturnType<typeof memberSession>>;

export const newKey = (): string => randomUUID();

/** A member with no session, for anything that only needs someone to be messaged. */
export async function bareMember(ctx: TestContext, tenantId: string, opts: Parameters<typeof createMembership>[3] = {}) {
  const user = await createUser(ctx);
  return createMembership(ctx, tenantId, user.id, opts);
}

/** The chat routes of one institution, as one member. */
export function chatApi(ctx: TestContext, slug: string, member: Pick<Session, "headers">) {
  const url = (path: string) => `/api/v1/t/${slug}/chat${path}`;
  const api = () => request(ctx.app);
  return {
    direct: (membershipId: string, body = "Hello there", clientKey = newKey()) => api().post(url("/direct")).set(member.headers).send({ membershipId, body, clientKey }),
    list: (inbox: "MAIN" | "REQUESTS" = "MAIN", extra: Record<string, unknown> = {}) => api().get(url("/conversations")).query({ inbox, ...extra }).set(member.headers),
    get: (id: string) => api().get(url(`/conversations/${id}`)).set(member.headers),
    messages: (id: string, query: Record<string, unknown> = {}) => api().get(url(`/conversations/${id}/messages`)).query(query).set(member.headers),
    send: (id: string, body = "Hello again", clientKey = newKey()) => api().post(url(`/conversations/${id}/messages`)).set(member.headers).send({ body, clientKey }),
    read: (id: string, seq: number) => api().post(url(`/conversations/${id}/read`)).set(member.headers).send({ seq }),
    mute: (id: string, until: string | null) => api().put(url(`/conversations/${id}/mute`)).set(member.headers).send({ until }),
    accept: (id: string) => api().post(url(`/conversations/${id}/accept`)).set(member.headers).send(),
    decline: (id: string) => api().post(url(`/conversations/${id}/decline`)).set(member.headers).send(),
    badge: () => api().get(url("/badge")).set(member.headers),
    blocks: () => api().get(url("/blocks")).set(member.headers),
    block: (membershipId: string) => api().post(url("/blocks")).set(member.headers).send({ membershipId }),
    unblock: (membershipId: string) => api().delete(url(`/blocks/${membershipId}`)).set(member.headers),
    report: (messageId: string, body: Record<string, unknown> = { reason: "HARASSMENT" }) => api().post(url(`/messages/${messageId}/report`)).set(member.headers).send(body),
  };
}

/** The group routes of one institution, as one member. */
export function groupsApi(ctx: TestContext, slug: string, member: Pick<Session, "headers">) {
  const url = (path: string) => `/api/v1/t/${slug}/chat/groups${path}`;
  const api = () => request(ctx.app);
  return {
    list: (query: Record<string, unknown> = {}) => api().get(url("")).query(query).set(member.headers),
    create: (body: Record<string, unknown>) => api().post(url("")).set(member.headers).send(body),
    invites: () => api().get(url("/invites")).set(member.headers),
    get: (id: string) => api().get(url(`/${id}`)).set(member.headers),
    edit: (id: string, body: Record<string, unknown>) => api().patch(url(`/${id}`)).set(member.headers).send(body),
    archive: (id: string) => api().patch(url(`/${id}`)).set(member.headers).send({ archived: true }),
    members: (id: string) => api().get(url(`/${id}/members`)).set(member.headers),
    candidates: (id: string, q?: string) => api().get(url(`/${id}/invite-candidates`)).query(q ? { q } : {}).set(member.headers),
    join: (id: string) => api().post(url(`/${id}/join`)).set(member.headers).send(),
    leave: (id: string) => api().post(url(`/${id}/leave`)).set(member.headers).send(),
    invite: (id: string, membershipIds: string[]) => api().post(url(`/${id}/invites`)).set(member.headers).send({ membershipIds }),
    accept: (id: string) => api().post(url(`/${id}/invites/accept`)).set(member.headers).send(),
    decline: (id: string) => api().post(url(`/${id}/invites/decline`)).set(member.headers).send(),
    remove: (id: string, membershipId: string) => api().delete(url(`/${id}/members/${membershipId}`)).set(member.headers),
    report: (id: string) => api().post(`/api/v1/t/${slug}/reports`).set(member.headers).send({ contentType: "GROUP", contentId: id, reason: "SPAM" }),
  };
}

/** Starts a group and returns it as its owner sees it. */
export async function createGroup(ctx: TestContext, slug: string, owner: Session, body: { name?: string; description?: string | null; visibility?: "OPEN" | "INVITE_ONLY" } = {}): Promise<ChatGroupDto> {
  const res = await groupsApi(ctx, slug, owner).create({ name: "Weekend runners", visibility: "OPEN", ...body });
  if (res.status !== 201) throw new Error(`POST /chat/groups failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as ChatGroupDto;
}

/**
 * Puts a message in a group as if its sender had sent it, through the same append every send uses. For tests about who
 * sees what, which don't need the send route's own rules.
 */
export async function postToGroup(ctx: TestContext, tenant: { id: string; slug: string }, conversationId: string, sender: Session, body: string): Promise<ChatMessageRow> {
  return runInTransaction(ctx, async (tx) => {
    const conversation = await lockConversation(tx, tenant.id, conversationId);
    return appendMessage(ctx, tx, { tenantSlug: tenant.slug, conversation: conversation!, sender: sender.membership, body, clientKey: newKey() });
  });
}

/** Sends a first message and returns the thread. */
export async function openRequest(ctx: TestContext, slug: string, from: Session, toMembershipId: string, body = "Hello there"): Promise<ChatDirectResultDto> {
  const res = await chatApi(ctx, slug, from).direct(toMembershipId, body);
  if (res.status !== 201) throw new Error(`POST /direct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as ChatDirectResultDto;
}

/** A thread both members are in, ready for normal messages. */
export async function acceptedThread(ctx: TestContext, slug: string, a: Session, b: Session): Promise<string> {
  const { conversation } = await openRequest(ctx, slug, a, b.membership.id);
  const res = await chatApi(ctx, slug, b).accept(conversation.id);
  if (res.status !== 200) throw new Error(`accept failed: ${res.status} ${JSON.stringify(res.body)}`);
  return conversation.id;
}

/** Moves a thread's last request into the past, so a test doesn't wait thirty days. */
export async function ageRequest(ctx: TestContext, conversationId: string, days: number): Promise<void> {
  const at = new Date(Date.now() - days * 86_400_000);
  await ctx.db.update(chatConversations).set({ requestedAt: at }).where(eq(chatConversations.id, conversationId));
  await ctx.db.update(chatParticipants).set({ withheldRequestedAt: at }).where(and(eq(chatParticipants.conversationId, conversationId), isNotNull(chatParticipants.withheldRequestedAt)));
}

export async function participantRow(ctx: TestContext, conversationId: string, membershipId: string) {
  const [row] = await ctx.db.select().from(chatParticipants).where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.membershipId, membershipId)));
  return row!;
}

export async function conversationRow(ctx: TestContext, id: string) {
  const [row] = await ctx.db.select().from(chatConversations).where(eq(chatConversations.id, id));
  return row!;
}

/** The parts of a thread's DTO that differ between two threads for no reason a member could act on, so two can be compared. */
export function comparable(dto: ChatConversationDto) {
  return { ...dto, id: "<id>", peer: dto.peer && { ...dto.peer, id: "<id>", fullName: "<name>" }, lastMessageAt: "<at>", lastMessage: dto.lastMessage && { ...dto.lastMessage, createdAt: "<at>" }, canRerequestAt: dto.canRerequestAt && "<at>" };
}

export function comparableMessage(dto: ChatMessageDto) {
  return { ...dto, id: "<id>", conversationId: "<id>", sender: dto.sender && { ...dto.sender, id: "<id>", fullName: "<name>" }, clientKey: dto.clientKey && "<key>", createdAt: "<at>" };
}
