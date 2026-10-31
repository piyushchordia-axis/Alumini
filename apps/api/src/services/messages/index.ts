import nodemailer from "nodemailer";
import type { Config } from "../../config/env";
import type { Logger } from "../../lib/logger";
import { ConsoleChannelSender } from "./providers/ConsoleChannelSender";
import { Msg91FlowClient, Msg91SmsSender } from "./providers/Msg91FlowClient";
import { SmtpEmailSender } from "./providers/SmtpEmailSender";
import { WhatsAppCloudClient, WhatsAppTemplateSender } from "./providers/WhatsAppCloudClient";
import type { MessageSenders } from "./types";

export * from "./types";
export { messageTemplates, type MessagePayloads, type MessageType } from "./templates";

/**
 * Channel senders from configuration. Configured channels use the real provider. Outside production, unconfigured
 * channels log to the console so flows can be tried; in production they are left out (messages skip them).
 */
export function createMessageSenders(config: Config, logger: Logger, fetchImpl: typeof fetch = fetch): MessageSenders {
  const senders: MessageSenders = {};
  const consoleFallback = !config.isProduction;

  if (config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID) {
    senders.WHATSAPP = new WhatsAppTemplateSender(
      new WhatsAppCloudClient({ accessToken: config.WHATSAPP_ACCESS_TOKEN, phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID, apiVersion: config.WHATSAPP_API_VERSION }, logger, fetchImpl),
    );
  } else if (consoleFallback) senders.WHATSAPP = new ConsoleChannelSender("WHATSAPP", logger);

  if (config.MSG91_AUTH_KEY) senders.SMS = new Msg91SmsSender(new Msg91FlowClient({ authKey: config.MSG91_AUTH_KEY }, logger, fetchImpl));
  else if (consoleFallback) senders.SMS = new ConsoleChannelSender("SMS", logger);

  if (config.SMTP_URL && config.EMAIL_FROM) senders.EMAIL = new SmtpEmailSender(nodemailer.createTransport(config.SMTP_URL), config.EMAIL_FROM, config.EMAIL_REPLY_TO);
  else if (consoleFallback) senders.EMAIL = new ConsoleChannelSender("EMAIL", logger);

  const available = Object.values(senders).map((s) => `${s.channel.toLowerCase()}:${s.provider}`);
  if (!config.isTest) logger.info({ channels: available }, "Outbound message channels");
  return senders;
}
