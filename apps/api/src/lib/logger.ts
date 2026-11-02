import pino, { type DestinationStream, type Logger } from "pino";

export type { Logger };

type ErrorLike = Error & Record<string, unknown>;

/** What a failed query says about its data: Drizzle's params, and a Postgres error's copy of the row ("Failing row contains ..."). */
const QUERY_DATA_KEYS = new Set(["params", "parameters", "detail", "where", "internalQuery"]);

const isErrorLike = (value: unknown): value is ErrorLike => !!value && typeof (value as { message?: unknown }).message === "string";

/** A copy of the error safe to log. Drizzle puts the parameters in its message, and so in the first line of its stack. */
function withoutQueryData(err: ErrorLike, depth = 0): Error {
  const isFailedQuery = typeof err.query === "string" && "params" in err;
  const message = isFailedQuery ? `Failed query: ${err.query as string}` : err.message;
  const stack = typeof err.stack === "string" ? err.stack : "";
  const messageAt = err.message ? stack.indexOf(err.message) : -1;
  const frames = messageAt === -1 ? "" : stack.slice(messageAt + err.message.length);

  const copy = new Error(message) as ErrorLike;
  Object.defineProperty(copy, "name", { value: err.name, enumerable: false, writable: true });
  copy.stack = messageAt === -1 && !isFailedQuery ? stack : `${err.name}: ${message}${frames}`;
  for (const key of Object.keys(err)) if (!QUERY_DATA_KEYS.has(key) && key !== "cause" && key !== "name") copy[key] = err[key];
  if (isErrorLike(err.cause) && depth < 3) copy.cause = withoutQueryData(err.cause, depth + 1);
  return copy;
}

/**
 * pino's error serializer, minus query data, so a failed insert can't put a private message in the logs. pino-http wraps
 * what it's given and passes the already serialized error, keeping the original as `raw`.
 */
export function errSerializer(err: unknown): unknown {
  const source = (err as { raw?: unknown } | null | undefined)?.raw ?? err;
  if (!isErrorLike(source)) return source;
  try {
    return { ...pino.stdSerializers.err(withoutQueryData(source)), type: source.constructor?.name ?? source.name };
  } catch {
    // Logging must never be what fails a request, and the raw error could carry the data this is here to keep out.
    return { type: source.constructor?.name ?? "Error", message: "An error that could not be serialized" };
  }
}

export function createLogger(level: string, pretty: boolean, destination?: DestinationStream): Logger {
  const serializers = { err: errSerializer };
  if (level === "silent") return pino({ level: "silent", serializers });
  if (destination) return pino({ level, serializers }, destination);
  if (pretty) {
    return pino({
      level,
      serializers,
      transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
    });
  }
  return pino({ level, serializers });
}
