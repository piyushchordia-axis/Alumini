import { idParamsSchema, paymentConfirmSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import { byUser, rateLimit } from "../../middleware/rateLimit";
import { requireMember } from "../../middleware/tenant";
import { ok, route } from "../../middleware/validate";
import { findPaymentOrder } from "../../repositories/payments.repo";
import { confirmPayment, getPaymentOrder, mockCheckoutFor } from "../../services/payments/payment.service";

/** A member's own payments. Orders are created by the feature being paid for (tickets, donations; Wave 3). */
export function paymentRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use("/payments", requireMember, (_req, _res, next) => {
    next(ctx.payments.provider ? undefined : new AppError(503, "PAYMENTS_DISABLED", "Online payments are not enabled"));
  });

  router.get(
    "/payments/:id",
    route({ params: idParamsSchema }, async ({ req, res, params }) => ok(res, await getPaymentOrder(ctx, req.tenantCtx!, req.membership!.id, params.id))),
  );

  router.post(
    "/payments/:id/confirm",
    rateLimit(ctx, { bucket: "payment-confirm", limit: 30, windowSec: 3600, keyFn: byUser }),
    route({ params: idParamsSchema, body: paymentConfirmSchema }, async ({ req, res, params, body }) =>
      ok(res, await confirmPayment(ctx, { tenantCtx: req.tenantCtx!, payerMembershipId: req.membership!.id, orderId: params.id, ...body })),
    ),
  );

  // Development only: lets the apps complete a payment without Razorpay keys.
  router.post(
    "/payments/:id/mock-checkout",
    route({ params: idParamsSchema }, async ({ req, res, params }) => {
      if (ctx.config.isProduction || ctx.payments.provider?.name !== "mock") throw AppError.notFound("Not found");
      const order = await findPaymentOrder(ctx.db, req.tenantCtx!.tenant.id, params.id);
      if (!order || order.payerMembershipId !== req.membership!.id) throw AppError.notFound("Payment not found");
      ok(res, mockCheckoutFor(order, ctx.payments.provider));
    }),
  );
  return router;
}
