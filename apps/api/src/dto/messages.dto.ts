import type { OutboundMessageDto } from "@illuminize/shared";
import type { OutboundMessageRow } from "../repositories/messages.repo";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toOutboundMessageDto(m: OutboundMessageRow): OutboundMessageDto {
  return {
    id: m.id,
    tenantId: m.tenantId,
    type: m.type,
    status: m.status,
    channels: m.channels,
    channel: m.channel,
    provider: m.provider,
    toPhone: m.toPhone,
    toEmail: m.toEmail,
    attempts: m.attempts,
    lastError: m.lastError,
    sentAt: iso(m.sentAt),
    failedAt: iso(m.failedAt),
    createdAt: m.createdAt.toISOString(),
  };
}
