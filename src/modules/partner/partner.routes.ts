import { celebrate, Joi, Segments } from 'celebrate';
import { Router } from 'express';
import type { OfferStatus, OrderStatus } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import {
  celebrateOptions,
  date,
  id,
  idNumber,
  money,
  publicId,
  time,
} from '../../lib/validation.js';
import { requireAuth, requireVenueRole } from '../../middleware/auth.js';
import * as listings from './listings.service.js';
import * as offers from './offers.service.js';
import { onboardingRouter } from './onboarding.routes.js';
import * as pickup from './pickup.service.js';

const member = requireVenueRole(['owner', 'staff'], { allowAdmin: true });
const memberNoAdmin = requireVenueRole(['owner', 'staff']);
const ownerNoAdmin = requireVenueRole(['owner']);

const venueParams = Joi.object({ venueId: id.required() });
const offerParams = Joi.object({ venueId: id.required(), offerId: id.required() });
const listingParams = Joi.object({ venueId: id.required(), listingId: id.required() });
const orderParams = Joi.object({ venueId: id.required(), publicId: publicId.required() });

const offerFields = {
  title: Joi.string().trim().min(3).max(120),
  description: Joi.string().trim().max(2000).allow('', null),
  categoryId: idNumber,
  photoUrl: Joi.string()
    .uri({ scheme: ['https', 'http'] })
    .max(500)
    .allow(null),
  originalPrice: money,
  price: money,
  estWeightKg: Joi.number().positive().max(50).precision(2),
  maxPerOrder: Joi.number().integer().min(1).max(5),
  tagIds: Joi.array().items(idNumber).max(20).unique(),
  allergenIds: Joi.array().items(idNumber).max(14).unique(),
};

const venueId = (params: Record<string, unknown>) => BigInt(params.venueId as string);

export const partnerRouter = Router();

partnerRouter.use(requireAuth);
partnerRouter.use(onboardingRouter);

partnerRouter.get('/venues', async (req, res) => {
  const memberships = await prisma.venueMember.findMany({
    where: { userId: req.user!.id, status: 'active', venue: { deletedAt: null } },
    include: {
      venue: { select: { id: true, slug: true, name: true, status: true, address: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json(
    memberships.map((m) => ({
      id: Number(m.venue.id),
      slug: m.venue.slug,
      name: m.venue.name,
      address: m.venue.address,
      status: m.venue.status,
      role: m.role,
    })),
  );
});

partnerRouter.get(
  '/venues/:venueId/offers',
  celebrate({
    [Segments.PARAMS]: venueParams,
    [Segments.QUERY]: Joi.object({ status: Joi.string().valid('active', 'paused', 'archived') }),
  }),
  member,
  async (req, res) => {
    res.json(
      await offers.listOffers(venueId(req.params), req.query.status as OfferStatus | undefined),
    );
  },
);

partnerRouter.post(
  '/venues/:venueId/offers',
  celebrate(
    {
      [Segments.PARAMS]: venueParams,
      [Segments.BODY]: Joi.object({
        ...offerFields,
        title: offerFields.title.required(),
        categoryId: offerFields.categoryId.required(),
        originalPrice: offerFields.originalPrice.required(),
        price: offerFields.price.required(),
      }),
    },
    celebrateOptions,
  ),
  ownerNoAdmin,
  async (req, res) => {
    res.status(201).json(await offers.createOffer(venueId(req.params), req.body));
  },
);

partnerRouter.get(
  '/venues/:venueId/offers/:offerId',
  celebrate({ [Segments.PARAMS]: offerParams }),
  member,
  async (req, res) => {
    res.json(await offers.getOffer(venueId(req.params), BigInt(req.params.offerId as string)));
  },
);

partnerRouter.patch(
  '/venues/:venueId/offers/:offerId',
  celebrate(
    {
      [Segments.PARAMS]: offerParams,
      [Segments.BODY]: Joi.object({
        ...offerFields,
        status: Joi.string().valid('active', 'paused'),
      }).min(1),
    },
    celebrateOptions,
  ),
  ownerNoAdmin,
  async (req, res) => {
    res.json(
      await offers.updateOffer(venueId(req.params), BigInt(req.params.offerId as string), req.body),
    );
  },
);

partnerRouter.delete(
  '/venues/:venueId/offers/:offerId',
  celebrate({ [Segments.PARAMS]: offerParams }),
  ownerNoAdmin,
  async (req, res) => {
    await offers.archiveOffer(venueId(req.params), BigInt(req.params.offerId as string));
    res.status(204).end();
  },
);

partnerRouter.get(
  '/venues/:venueId/listings',
  celebrate({ [Segments.PARAMS]: venueParams, [Segments.QUERY]: Joi.object({ date }) }),
  member,
  async (req, res) => {
    res.json(
      await listings.listListings(venueId(req.params), req.query.date as string | undefined),
    );
  },
);

partnerRouter.post(
  '/venues/:venueId/listings',
  celebrate(
    {
      [Segments.PARAMS]: venueParams,
      [Segments.BODY]: Joi.object({
        offerId: idNumber.required(),
        date: date.required(),
        pickupStart: time.required(),
        pickupEnd: time.required(),
        quantity: Joi.number().integer().min(1).max(500).required(),
      }),
    },
    celebrateOptions,
  ),
  memberNoAdmin,
  async (req, res) => {
    res.status(201).json(await listings.createListing(venueId(req.params), req.body));
  },
);

partnerRouter.patch(
  '/venues/:venueId/listings/:listingId',
  celebrate(
    {
      [Segments.PARAMS]: listingParams,
      [Segments.BODY]: Joi.object({
        quantityTotal: Joi.number().integer().min(0).max(500),
        pickupStart: time,
        pickupEnd: time,
      }).min(1),
    },
    celebrateOptions,
  ),
  memberNoAdmin,
  async (req, res) => {
    res.json(
      await listings.updateListing(
        venueId(req.params),
        BigInt(req.params.listingId as string),
        req.body,
      ),
    );
  },
);

partnerRouter.post(
  '/venues/:venueId/listings/:listingId/close',
  celebrate({ [Segments.PARAMS]: listingParams }),
  memberNoAdmin,
  async (req, res) => {
    res.json(
      await listings.closeListing(venueId(req.params), BigInt(req.params.listingId as string)),
    );
  },
);

partnerRouter.post(
  '/venues/:venueId/listings/:listingId/cancel',
  celebrate({
    [Segments.PARAMS]: listingParams,
    [Segments.BODY]: Joi.object({ reason: Joi.string().trim().min(3).max(255).required() }),
  }),
  ownerNoAdmin,
  async (req, res) => {
    res.json(
      await pickup.cancelListing(
        venueId(req.params),
        BigInt(req.params.listingId as string),
        req.body.reason,
        req.user!.id,
      ),
    );
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

partnerRouter.get(
  '/venues/:venueId/orders',
  celebrate({
    [Segments.PARAMS]: venueParams,
    [Segments.QUERY]: Joi.object({ date, status: Joi.string().valid(...orderStatuses) }),
  }),
  member,
  async (req, res) => {
    res.json(
      await pickup.listVenueOrders(
        venueId(req.params),
        req.query.date as string | undefined,
        req.query.status as OrderStatus | undefined,
      ),
    );
  },
);

partnerRouter.post(
  '/venues/:venueId/pickups/verify',
  celebrate({
    [Segments.PARAMS]: venueParams,
    [Segments.BODY]: Joi.object({
      qrToken: Joi.string().max(500),
      code: Joi.string()
        .trim()
        .length(6)
        .pattern(/^[A-Za-z0-9]{6}$/),
    }).xor('qrToken', 'code'),
  }),
  memberNoAdmin,
  async (req, res) => {
    res.json(await pickup.verifyPickup(venueId(req.params), req.body));
  },
);

partnerRouter.post(
  '/venues/:venueId/orders/:publicId/pickup',
  celebrate({ [Segments.PARAMS]: orderParams }),
  memberNoAdmin,
  async (req, res) => {
    res.json(
      await pickup.pickupOrder(venueId(req.params), req.params.publicId as string, req.user!.id),
    );
  },
);

partnerRouter.post(
  '/venues/:venueId/orders/:publicId/cancel',
  celebrate({
    [Segments.PARAMS]: orderParams,
    [Segments.BODY]: Joi.object({ reason: Joi.string().trim().min(3).max(255).required() }),
  }),
  ownerNoAdmin,
  async (req, res) => {
    res.json(
      await pickup.cancelVenueOrder(
        venueId(req.params),
        req.params.publicId as string,
        req.body.reason,
        req.user!.id,
      ),
    );
  },
);
