import { celebrate, Joi, Segments } from 'celebrate';
import { Router } from 'express';
import { env } from '../../config/env.js';
import { notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { processPaymentResult } from './payments.service.js';

export const paymentsRouter = Router();

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
