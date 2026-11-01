import express, { Router } from "express";
import type { AppContext } from "../context";
import { ok } from "../middleware/validate";
import { recordPaymentWebhook } from "../services/payments/payment.service";

/**
 * Provider webhooks, mounted before the JSON body parser: signatures are checked over the exact raw bytes, so the body
 * must never be parsed and re-serialised first. Configure in the Razorpay dashboard:
 * `${PUBLIC_BASE_URL}/api/v1/webhooks/razorpay` with the payment, order and refund events.
 */
export function webhookRoutes(ctx: AppContext): Router {
  const router = Router();
  router.post("/razorpay", express.raw({ type: () => true, limit: "1mb" }), async (req, res, next) => {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const { duplicate } = await recordPaymentWebhook(ctx, "razorpay", raw, req.headers);
      ok(res, { received: true, duplicate });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
