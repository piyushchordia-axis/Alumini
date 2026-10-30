import type { Config } from "../../config/env";
import type { Logger } from "../../lib/logger";
import { ConsoleOtpSender } from "./ConsoleOtpSender";
import { FallbackOtpSender } from "./FallbackOtpSender";
import type { OtpSender } from "./OtpSender";
import { SmsOtpSender } from "./SmsOtpSender";
import { WhatsAppCloudOtpSender } from "./WhatsAppCloudOtpSender";

export type { OtpSender, OtpSendResult } from "./OtpSender";
export { OtpSendError } from "./OtpSender";
export { ConsoleOtpSender, FallbackOtpSender, SmsOtpSender, WhatsAppCloudOtpSender };

function smsSenderIfConfigured(config: Config, logger: Logger): SmsOtpSender | null {
  if (config.MSG91_AUTH_KEY && config.MSG91_TEMPLATE_ID) {
    return new SmsOtpSender({ authKey: config.MSG91_AUTH_KEY, templateId: config.MSG91_TEMPLATE_ID }, logger);
  }
  return null;
}

export function createOtpSender(config: Config, logger: Logger): OtpSender {
  const console_ = new ConsoleOtpSender(logger);
  switch (config.OTP_PROVIDER) {
    case "console":
      return console_;
    case "sms": {
      const sms = smsSenderIfConfigured(config, logger);
      if (sms) return sms;
      if (config.isProduction) throw new Error("OTP_PROVIDER=sms requires MSG91_AUTH_KEY and MSG91_TEMPLATE_ID");
      logger.warn("OTP_PROVIDER=sms but SMS is not configured; falling back to console sender");
      return console_;
    }
    case "whatsapp": {
      if (!config.WHATSAPP_ACCESS_TOKEN || !config.WHATSAPP_PHONE_NUMBER_ID) {
        if (config.isProduction) throw new Error("OTP_PROVIDER=whatsapp requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID");
        logger.warn("OTP_PROVIDER=whatsapp but WhatsApp is not configured; falling back to console sender");
        return console_;
      }
      const whatsapp = new WhatsAppCloudOtpSender(
        {
          accessToken: config.WHATSAPP_ACCESS_TOKEN,
          phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
          templateName: config.WHATSAPP_TEMPLATE_NAME,
          templateLang: config.WHATSAPP_TEMPLATE_LANG,
          apiVersion: config.WHATSAPP_API_VERSION,
        },
        logger,
      );
      const sms = smsSenderIfConfigured(config, logger);
      if (sms) return new FallbackOtpSender(whatsapp, sms, logger);
      if (!config.isProduction) return new FallbackOtpSender(whatsapp, console_, logger);
      return whatsapp;
    }
  }
}
