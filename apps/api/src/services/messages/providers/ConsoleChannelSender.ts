import type { MessageChannel } from "@illuminize/shared";
import { randomUUID } from "node:crypto";
import type { Logger } from "../../../lib/logger";
import type { ChannelSender, RenderedMessage } from "../types";

/** Development stand-in for a channel: logs the rendered message instead of sending it. */
export class ConsoleChannelSender<C extends MessageChannel> implements ChannelSender<C> {
  readonly provider = "console";
  constructor(
    readonly channel: C,
    private readonly logger: Logger,
  ) {}
  async send(m: Extract<RenderedMessage, { channel: C }>) {
    this.logger.info({ message: m }, `Outbound ${this.channel.toLowerCase()} message (console, not sent)`);
    return { providerMessageId: `console-${randomUUID()}` };
  }
}
