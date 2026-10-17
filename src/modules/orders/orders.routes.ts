import { celebrate, Joi, Segments } from 'celebrate';
import { Router } from 'express';
import { celebrateOptions, idNumber, publicId } from '../../lib/validation.js';
import { requireAuth, requireVerifiedEmail } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import * as orders from './orders.service.js';

const orderParams = Joi.object({ publicId: publicId.required() });

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

ordersRouter.post(
  '/',
  rateLimit({ points: 20, durationSec: 60, key: (req) => `orders|${req.user?.id ?? req.ip}` }),
  requireVerifiedEmail,
  celebrate(
    {
      [Segments.HEADERS]: Joi.object({ 'idempotency-key': Joi.string().guid() }).unknown(true),
      [Segments.BODY]: Joi.object({
        listingId: idNumber.required(),
        quantity: Joi.number().integer().min(1).max(5).required(),
        source: Joi.string().valid('search', 'map', 'recommendation', 'favorite', 'direct'),
      }),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    const key = req.get('idempotency-key') || undefined;
    const result = await orders.createOrder(req.user!.id, req.body, key);
    res.status(result.replayed ? 200 : 201).json({ order: result.order, payment: result.payment });
  },
);

ordersRouter.get(
  '/',
  celebrate({
    [Segments.QUERY]: Joi.object({
      status: Joi.string().valid('active', 'history').default('active'),
    }),
  }),
  async (req, res) => {
    res.json(await orders.listOrders(req.user!.id, req.query.status as 'active' | 'history'));
  },
);

ordersRouter.get('/:publicId', celebrate({ [Segments.PARAMS]: orderParams }), async (req, res) => {
  res.json(await orders.getOrder(req.user!.id, req.params.publicId as string));
});

ordersRouter.get(
  '/:publicId/voucher',
  celebrate({ [Segments.PARAMS]: orderParams }),
  async (req, res) => {
    res.json(await orders.getVoucher(req.user!.id, req.params.publicId as string));
  },
);

ordersRouter.post(
  '/:publicId/pay',
  celebrate({ [Segments.PARAMS]: orderParams }),
  async (req, res) => {
    res.json({ payment: await orders.retryPayment(req.user!.id, req.params.publicId as string) });
  },
);

ordersRouter.post(
  '/:publicId/cancel',
  celebrate({
    [Segments.PARAMS]: orderParams,
    [Segments.BODY]: Joi.object({ reason: Joi.string().trim().max(255).allow('') }),
  }),
  async (req, res) => {
    res.json(
      await orders.cancelByCustomer(
        req.user!.id,
        req.params.publicId as string,
        req.body?.reason || undefined,
      ),
    );
  },
);
