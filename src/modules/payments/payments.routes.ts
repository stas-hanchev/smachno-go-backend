import { celebrate, Joi, Segments } from 'celebrate';
import express, { Router, type Request, type Response } from 'express';
import { env } from '../../config/env.js';
import { notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import {
  handleLiqpayCallback,
  processPaymentResult,
  syncPaymentStatus,
} from './payments.service.js';

export const paymentsRouter = Router();

const form = express.urlencoded({ extended: false, limit: '64kb' });

if (env.LIQPAY_PRIVATE_KEY) {
  paymentsRouter.post('/liqpay/callback', form, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await handleLiqpayCallback(body.data, body.signature);
    res.status(result.httpStatus).json({ ok: result.httpStatus === 200 });
  });
}

async function handleReturn(req: Request, res: Response) {
  const orderId = typeof req.query.orderId === 'string' ? req.query.orderId.slice(0, 64) : '';
  const payment = orderId
    ? await prisma.payment.findUnique({
        where: { providerOrderId: orderId },
        include: { order: { select: { publicId: true } } },
      })
    : null;
  if (!payment) {
    res.redirect(303, `${env.APP_URL}/orders`);
    return;
  }
  if (payment.status === 'created' || payment.status === 'processing') {
    try {
      await syncPaymentStatus(payment.providerOrderId);
    } catch (err) {
      logger.warn({ err, providerOrderId: payment.providerOrderId }, 'Payment status check failed');
    }
  }
  res.redirect(303, `${env.APP_URL}/orders/${payment.order.publicId}?payment=return`);
}

const returnLimit = rateLimit({ points: 30, durationSec: 60 });
paymentsRouter.get('/liqpay/return', returnLimit, handleReturn);
paymentsRouter.post('/liqpay/return', returnLimit, form, handleReturn);

if (env.PAYMENT_PROVIDER === 'fake') {
  paymentsRouter.post(
    '/fake/:providerOrderId/confirm',
    requireAuth,
    celebrate({
      [Segments.PARAMS]: Joi.object({ providerOrderId: Joi.string().max(64).required() }),
      [Segments.BODY]: Joi.object({
        result: Joi.string().valid('success', 'failure').default('success'),
      }),
    }),
    async (req, res) => {
      const providerOrderId = req.params.providerOrderId as string;
      const payment = await prisma.payment.findUnique({
        where: { providerOrderId },
        include: { order: { select: { userId: true, publicId: true } } },
      });
      if (!payment || payment.order.userId !== req.user!.id) throw notFound('Платіж не знайдено');

      const outcome = await processPaymentResult({
        providerOrderId,
        status: req.body?.result ?? 'success',
        providerPaymentId: `fake-${providerOrderId}`,
        method: 'card',
        raw: { provider: 'fake', result: req.body?.result ?? 'success' },
      });
      res.json({ outcome, orderPublicId: payment.order.publicId });
    },
  );
}
