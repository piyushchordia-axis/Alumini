import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { AppContext } from "./context";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { apiRouter } from "./routes";
import { webhookRoutes } from "./routes/webhooks.routes";

export function createApp(ctx: AppContext): Express {
  const app = express();
  const { config, logger } = ctx;

  app.set("trust proxy", config.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(requestId);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: config.corsOrigins === "*" ? true : config.corsOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "Retry-After"],
    }),
  );
  if (!config.isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as express.Request).id,
        autoLogging: { ignore: (req) => req.url?.endsWith("/health") ?? false },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return "error";
          if (res.statusCode >= 400) return "warn";
          return "info";
        },
      }),
    );
  }

  // Webhooks read their raw body (signature checks), so they come before the JSON parser.
  app.use("/api/v1/webhooks", webhookRoutes(ctx));
  app.use(express.json({ limit: "1mb" }));

  app.use("/uploads", express.static(config.uploadDirAbsolute, { maxAge: "7d", immutable: true, fallthrough: true }));
  app.use("/api/v1", apiRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
