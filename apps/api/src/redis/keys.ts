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
  cacheTenant: (slug: string) => `cache:tenant:${slug}`,
  cacheDirectoryFilters: (tenantId: string) => `cache:directory:filters:${tenantId}`,
  rateLimit: (bucket: string, key: string) => `rl:${bucket}:${key}`,
  uploadsDay: (tenantId: string, day: string) => `uploads:day:${tenantId}:${day}`,
  active: (membershipId: string) => `active:${membershipId}`,
  /** Sorted set of "ticketId|token" scored by send time, for Expo receipt checks. */
  pushReceipts: () => `push:receipts`,
} as const;
