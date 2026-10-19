import { celebrate, Joi, Segments } from 'celebrate';
import { Router } from 'express';
import { celebrateOptions, idNumber } from '../../lib/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import * as notifications from './notifications.service.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/notifications',
  celebrate({
    [Segments.QUERY]: Joi.object({
      unread: Joi.boolean().default(false),
      limit: Joi.number().integer().min(1).max(100).default(50),
    }),
  }),
  async (req, res) => {
    const query = req.query as unknown as { unread: boolean; limit: number };
    res.json(await notifications.listNotifications(req.user!.id, query.unread, query.limit));
  },
);

notificationsRouter.post(
  '/notifications/read',
  celebrate({
    [Segments.BODY]: Joi.object({ ids: Joi.array().items(idNumber).max(100) }),
  }),
  async (req, res) => {
    res.json(await notifications.markRead(req.user!.id, req.body?.ids));
  },
);

notificationsRouter.get('/notification-settings', async (req, res) => {
  res.json(await notifications.getNotificationSettings(req.user!.id));
});

notificationsRouter.patch(
  '/notification-settings',
  celebrate(
    {
      [Segments.BODY]: Joi.object({
        emailEnabled: Joi.boolean(),
        pushEnabled: Joi.boolean(),
        orderUpdates: Joi.boolean(),
        pickupReminders: Joi.boolean(),
        favoritesNewListings: Joi.boolean(),
        marketing: Joi.boolean(),
      }).min(1),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    res.json(await notifications.updateNotificationSettings(req.user!.id, req.body));
  },
);
