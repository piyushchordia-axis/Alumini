import type { MessageChannel } from "@illuminize/shared";
import type { ChannelSender, MessageSendError, RenderedMessage } from "../../src/services/messages/types";

/** Records what it "sends"; queue errors to make the next sends fail. */
export class CapturingSender<C extends MessageChannel> implements ChannelSender<C> {
  readonly provider = "capture";
  readonly sent: RenderedMessage[] = [];
  readonly failures: MessageSendError[] = [];
  constructor(readonly channel: C) {}
  async send(m: Extract<RenderedMessage, { channel: C }>) {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(m);
    return { providerMessageId: `${this.channel}-${this.sent.length}` };
  }
}

/** A capturing sender for every channel, and a way to empty them between tests. */
export function capturingSenders() {
  const senders = { WHATSAPP: new CapturingSender("WHATSAPP"), SMS: new CapturingSender("SMS"), EMAIL: new CapturingSender("EMAIL") };
  const reset = () => {
    for (const s of Object.values(senders)) {
      s.sent.length = 0;
      s.failures.length = 0;
    }
  };
  return { senders, reset };
}
