import { z } from "zod";
import { OTP_LENGTH, PUSH_PLATFORMS } from "../constants";

/** Raw phone input; the API normalises it to E.164 (default region IN). */
export const phoneInputSchema = z.string().trim().min(6).max(24);

export const otpRequestSchema = z.object({
  phone: phoneInputSchema,
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: phoneInputSchema,
  code: z.string().trim().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(20).max(512).optional(),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

export const pushTokenSchema = z.object({
  token: z.string().trim().min(10).max(500),
  platform: z.enum(PUSH_PLATFORMS),
});
export type PushTokenInput = z.infer<typeof pushTokenSchema>;

export const pushTokenParamsSchema = z.object({ token: z.string().min(10).max(500) });

/** An email address as members type it; stored lower-cased. */
export const emailAddressSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email("Enter a valid email address"))
  .transform((v) => v.toLowerCase());

export const emailChangeSchema = z.object({ email: emailAddressSchema });
export type EmailChangeInput = z.infer<typeof emailChangeSchema>;

export const emailVerifySchema = z.object({ token: z.string().trim().min(20).max(100) });
export type EmailVerifyInput = z.infer<typeof emailVerifySchema>;

export const deleteAccountSchema = z.object({
  confirm: z.literal(true),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
