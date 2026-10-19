import { celebrate, Joi, Segments } from 'celebrate';
import { Router, type Request } from 'express';
import type { ApplicationStatus, OrderStatus, UserRole } from '../../generated/prisma/client.js';
import { getSettings, type BusinessSettings } from '../../lib/settings.js';
import {
  celebrateOptions,
  date,
  id,
  idNumber,
  lat,
  lng,
  pagination,
  publicId,
} from '../../lib/validation.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as partners from './admin-partners.service.js';
import type { AdminActor, Page } from './admin-partners.service.js';
import * as system from './admin-system.service.js';
import type { DictionaryName } from './admin-system.service.js';
import * as usersOrders from './admin-users-orders.service.js';

const actorOf = (req: Request): AdminActor => ({
  id: req.user!.id,
  role: req.user!.role,
  ip: req.ip,
});
const idParam = Joi.object({ id: id.required() });
const paramId = (req: Request) => BigInt(req.params.id as string);
const pageQuery = (extra: Record<string, Joi.Schema>) =>
  celebrate({ [Segments.QUERY]: Joi.object({ ...pagination, ...extra }) }, celebrateOptions);
const commissionRate = Joi.number().min(0).max(0.5).precision(4);
const slug = Joi.string()
  .trim()
  .lowercase()
  .max(100)
  .pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin', 'super_admin'));

adminRouter.get(
  '/applications',
  pageQuery({ status: Joi.string().valid('submitted', 'approved', 'rejected') }),
  async (req, res) => {
    res.json(
      await partners.listApplications(
        req.query as unknown as { status?: ApplicationStatus } & Page,
      ),
    );
  },
);

adminRouter.get(
  '/applications/:id',
  celebrate({ [Segments.PARAMS]: idParam }),
  async (req, res) => {
    res.json(await partners.getApplication(paramId(req)));
  },
);

adminRouter.post(
  '/applications/:id/approve',
  celebrate(
    {
      [Segments.PARAMS]: idParam,
      [Segments.BODY]: Joi.object({
        categoryId: idNumber.required(),
        cityId: idNumber.required(),
        name: Joi.string().trim().min(2).max(255),
        lat,
        lng,
        commissionRate,
      }).and('lat', 'lng'),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    res.json(await partners.approveApplication(paramId(req), req.body, actorOf(req)));
  },
);

adminRouter.post(
  '/applications/:id/reject',
  celebrate({
    [Segments.PARAMS]: idParam,
    [Segments.BODY]: Joi.object({ reason: Joi.string().trim().min(3).max(500).required() }),
  }),
  async (req, res) => {
    res.json(await partners.rejectApplication(paramId(req), req.body.reason, actorOf(req)));
  },
);

adminRouter.get(
  '/venues',
  pageQuery({
    q: Joi.string().trim().max(100).allow(''),
    status: Joi.string().valid('draft', 'active', 'paused', 'blocked'),
    cityId: idNumber,
  }),
  async (req, res) => {
    const query = req.query as unknown as Parameters<typeof partners.listVenues>[0];
    res.json(await partners.listVenues({ ...query, q: query.q || undefined }));
  },
);

adminRouter.get('/venues/:id', celebrate({ [Segments.PARAMS]: idParam }), async (req, res) => {
  res.json(await partners.getVenue(paramId(req)));
});

adminRouter.patch(
  '/venues/:id',
  celebrate(
    {
      [Segments.PARAMS]: idParam,
      [Segments.BODY]: Joi.object({
        status: Joi.string().valid('active', 'paused', 'blocked'),
        commissionRate,
      }).min(1),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    res.json(await partners.updateVenue(paramId(req), req.body, actorOf(req)));
  },
);

const roles: UserRole[] = ['customer', 'admin', 'super_admin'];

adminRouter.get(
  '/users',
  pageQuery({
    q: Joi.string().trim().max(100).allow(''),
    role: Joi.string().valid(...roles),
    status: Joi.string().valid('active', 'blocked', 'deleted'),
  }),
  async (req, res) => {
    const query = req.query as unknown as Parameters<typeof usersOrders.listUsers>[0];
    res.json(await usersOrders.listUsers({ ...query, q: query.q || undefined }));
  },
);

adminRouter.get('/users/:id', celebrate({ [Segments.PARAMS]: idParam }), async (req, res) => {
  res.json(await usersOrders.getUser(paramId(req)));
});

adminRouter.patch(
  '/users/:id',
  celebrate(
    {
      [Segments.PARAMS]: idParam,
      [Segments.BODY]: Joi.object({
        status: Joi.string().valid('active', 'blocked'),
        role: Joi.string().valid(...roles),
      }).min(1),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    res.json(await usersOrders.updateUser(paramId(req), req.body, actorOf(req)));
  },
);

const orderStatuses: OrderStatus[] = [
  'pending_payment',
  'paid',
  'picked_up',
  'cancelled_by_customer',
  'cancelled_by_venue',
  'expired',
  'no_show',
  'refunded',
];

adminRouter.get(
  '/orders',
  pageQuery({
    q: Joi.string().trim().max(255).allow(''),
    status: Joi.string().valid(...orderStatuses),
    venueId: idNumber,
    date,
  }),
  async (req, res) => {
    const query = req.query as unknown as Parameters<typeof usersOrders.listOrders>[0];
    res.json(await usersOrders.listOrders({ ...query, q: query.q || undefined }));
  },
);

const orderParam = Joi.object({ publicId: publicId.required() });

adminRouter.get(
  '/orders/:publicId',
  celebrate({ [Segments.PARAMS]: orderParam }),
  async (req, res) => {
    res.json(await usersOrders.getOrder(req.params.publicId as string));
  },
);

adminRouter.post(
  '/orders/:publicId/refund',
  celebrate({
    [Segments.PARAMS]: orderParam,
    [Segments.BODY]: Joi.object({ reason: Joi.string().trim().min(3).max(255).required() }),
  }),
  async (req, res) => {
    res.json(
      await usersOrders.refundOrder(req.params.publicId as string, req.body.reason, actorOf(req)),
    );
  },
);

const dictionaryFields: Record<DictionaryName, Record<string, Joi.Schema>> = {
  categories: {
    name: Joi.string().trim().min(2).max(100),
    slug,
    icon: Joi.string().trim().max(50).allow(null),
    sortOrder: Joi.number().integer().min(0).max(1000),
    isActive: Joi.boolean(),
  },
  tags: { name: Joi.string().trim().min(2).max(100), slug },
  allergens: { name: Joi.string().trim().min(2).max(100), slug },
  cities: {
    name: Joi.string().trim().min(2).max(100),
    slug,
    centerLat: lat,
    centerLng: lng,
    isActive: Joi.boolean(),
  },
};

const REQUIRED_ON_CREATE: Record<DictionaryName, string[]> = {
  categories: ['name', 'slug'],
  tags: ['name', 'slug'],
  allergens: ['name', 'slug'],
  cities: ['name', 'slug', 'centerLat', 'centerLng'],
};

for (const name of Object.keys(dictionaryFields) as DictionaryName[]) {
  const fields = dictionaryFields[name];
  const createSchema = Joi.object(
    Object.fromEntries(
      Object.entries(fields).map(([key, schema]) => [
        key,
        REQUIRED_ON_CREATE[name].includes(key) ? schema.required() : schema,
      ]),
    ),
  );

  adminRouter.get(`/${name}`, async (_req, res) => {
    res.json(await system.listDictionary(name));
  });

  adminRouter.post(
    `/${name}`,
    celebrate({ [Segments.BODY]: createSchema }, celebrateOptions),
    async (req, res) => {
      res.status(201).json(await system.createDictionaryItem(name, req.body, actorOf(req)));
    },
  );

  adminRouter.patch(
    `/${name}/:id`,
    celebrate(
      { [Segments.PARAMS]: idParam, [Segments.BODY]: Joi.object(fields).min(1) },
      celebrateOptions,
    ),
    async (req, res) => {
      res.json(await system.updateDictionaryItem(name, paramId(req), req.body, actorOf(req)));
    },
  );

  adminRouter.delete(
    `/${name}/:id`,
    celebrate({ [Segments.PARAMS]: idParam }),
    async (req, res) => {
      await system.deleteDictionaryItem(name, paramId(req), actorOf(req));
      res.status(204).end();
    },
  );
}

const settingsSchema: Record<keyof BusinessSettings, Joi.Schema> = {
  min_price_ratio: Joi.number().min(0).max(0.9),
  reservation_ttl_min: Joi.number().integer().min(5).max(60),
  cancel_deadline_hours: Joi.number().integer().min(0).max(48),
  grace_period_min: Joi.number().integer().min(0).max(120),
  sales_close_offset_min: Joi.number().integer().min(0).max(120),
  co2_per_kg: Joi.number().min(0).max(20),
  default_commission_rate: commissionRate,
};

adminRouter.get('/settings', async (_req, res) => {
  res.json(await getSettings());
});

adminRouter.put(
  '/settings',
  celebrate({ [Segments.BODY]: Joi.object(settingsSchema).min(1) }, celebrateOptions),
  async (req, res) => {
    res.json(await system.updateSettings(req.body, actorOf(req)));
  },
);

adminRouter.get(
  '/audit-log',
  pageQuery({
    entityType: Joi.string().trim().max(50),
    entityId: idNumber,
    actorId: idNumber,
    action: Joi.string().trim().max(100),
  }),
  async (req, res) => {
    res.json(
      await system.listAuditLog(req.query as unknown as Parameters<typeof system.listAuditLog>[0]),
    );
  },
);
