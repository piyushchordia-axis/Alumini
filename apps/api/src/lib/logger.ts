import pino, { type Logger } from "pino";

export type { Logger };

export function createLogger(level: string, pretty: boolean): Logger {
  if (level === "silent") return pino({ level: "silent" });
  if (pretty) {
    return pino({
      level,
      transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
    });
  }
  return pino({ level });
}
