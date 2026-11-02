/** Socket.IO rooms. A socket joins its user and session rooms on connect. Chat has no rooms of its own: it resolves who may receive on every send. */
export const rooms = {
  user: (userId: string) => `user:${userId}`,
  session: (sid: string) => `session:${sid}`,
};
