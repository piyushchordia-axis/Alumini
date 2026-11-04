/** Central registry of Redis key builders so naming stays consistent. */
export const keys = {
  otp: (phone: string) => `otp:${phone}`,
  otpCooldown: (phone: string) => `otp:cooldown:${phone}`,
  otpCountHour: (phone: string) => `otp:count:h:${phone}`,
  otpCountDay: (phone: string) => `otp:count:d:${phone}`,
  otpCountIp: (ip: string) => `otp:count:ip:${ip}`,
  otpGlobalDay: (day: string) => `otp:count:global:${day}`,
  otpLock: (phone: string) => `otp:lock:${phone}`,
  otpBurned: (phone: string) => `otp:burned:${phone}`,
  otpWrongIp: (ip: string) => `otp:wrong:ip:${ip}`,
  refresh: (tokenHash: string) => `refresh:${tokenHash}`,
  session: (sid: string) => `session:${sid}`,
  userSessions: (userId: string) => `user:sessions:${userId}`,
  cacheTenantsList: () => `cache:tenants:list`,
  /** Versioned: bump when the cached tenant/settings row shape changes, so old entries are not revived. */
  cacheTenant: (slug: string) => `cache:tenant:v5:${slug}`,
  /** Versioned like cacheTenant: v3 added the industries, skills and fields of study. */
  cacheDirectoryFilters: (tenantId: string) => `cache:directory:filters:v3:${tenantId}`,
  /** An institution's active profile fields (definitions only). */
  cacheProfileFields: (tenantId: string) => `cache:profile-fields:v1:${tenantId}`,
  rateLimit: (bucket: string, key: string) => `rl:${bucket}:${key}`,
  /** Confirmation emails sent to one address (hashed) per day, and platform-wide per day. */
  emailVerifyAddressDay: (addressHash: string) => `email:verify:addr:${addressHash}`,
  emailVerifyGlobalDay: (day: string) => `email:verify:global:${day}`,
  uploadsDay: (tenantId: string, day: string) => `uploads:day:${tenantId}:${day}`,
  /** Invitations queued for sending by one institution on one (billing time zone) day. */
  invitesDay: (tenantId: string, day: string) => `invites:day:${tenantId}:${day}`,
  active: (membershipId: string) => `active:${membershipId}`,
  /** Set while a member has been pushed about a conversation and hasn't read it since. */
  chatPushQuiet: (conversationId: string, membershipId: string) => `chat:push:quiet:${conversationId}:${membershipId}`,
  /** Set once a member has been pushed about one invitation, so a retried job doesn't push it twice. */
  chatPushInvite: (conversationId: string, membershipId: string, invitedAtMs: number) => `chat:push:invite:${conversationId}:${membershipId}:${invitedAtMs}`,
  /** Sorted set of "ticketId|token" scored by send time, for Expo receipt checks. */
  pushReceipts: () => `push:receipts`,
} as const;
