import type { Request, RequestHandler, Response } from "express";
import type { ZodType } from "zod";

export interface Schemas<B, Q, P> {
  body?: ZodType<B>;
  query?: ZodType<Q>;
  params?: ZodType<P>;
}

export interface RouteInput<B, Q, P> {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: P;
}

/**
 * Builds an Express handler that validates body/query/params with zod before
 * calling `fn`. Zod errors propagate to the error handler as VALIDATION_ERROR.
 * Express 5 exposes `req.query` as a getter, so parsed values are passed explicitly.
 */
export function route<B = undefined, Q = undefined, P = undefined>(
  schemas: Schemas<B, Q, P>,
  fn: (input: RouteInput<B, Q, P>) => Promise<unknown> | unknown,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const body = (schemas.body ? schemas.body.parse(req.body ?? {}) : undefined) as B;
      const query = (schemas.query ? schemas.query.parse(req.query ?? {}) : undefined) as Q;
      const params = (schemas.params ? schemas.params.parse(req.params ?? {}) : undefined) as P;
      await fn({ req, res, body, query, params });
    } catch (err) {
      next(err);
    }
  };
}

export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data });
}

export function noContent(res: Response): void {
  res.status(204).end();
}
