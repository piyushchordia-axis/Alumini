import type { RequestHandler } from "express";

/** Private messages must never sit in a browser or proxy cache, and that holds for error responses too. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};
