/** Socket.IO rooms. A socket joins its user and session rooms on connect; Wave 2 adds conversations. */
export const rooms = {
  user: (userId: string) => `user:${userId}`,
  session: (sid: string) => `session:${sid}`,
};
