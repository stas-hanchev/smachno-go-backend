import { celebrate, Joi, Segments } from 'celebrate';
import { Router } from 'express';
import { notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';
import { addMinutes } from '../../lib/time.js';
import { id } from '../../lib/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import { publicRating } from '../catalog/listing.dto.js';

const venueParams = Joi.object({ venueId: id.required() });

const FAVORITE_SIGNAL_OFFERS = 5;

export const favoritesRouter = Router();

favoritesRouter.use(requireAuth);

favoritesRouter.get('/', async (req, res) => {
  const settings = await getSettings();
  const salesCloseAt = addMinutes(new Date(), settings.sales_close_offset_min);
  const favorites = await prisma.favorite.findMany({
    where: { userId: req.user!.id, venue: { status: 'active', deletedAt: null } },
    include: {
      venue: {
        include: {
          category: { select: { id: true, name: true } },
          _count: {
            select: {
              listings: {
                where: {
                  status: 'on_sale',
                  quantityLeft: { gt: 0 },
                  pickupEnd: { gt: salesCloseAt },
                  offer: { status: 'active' },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(
    favorites.map(({ venue, notifyNewListings, createdAt }) => ({
      venue: {
        id: Number(venue.id),
        slug: venue.slug,
        name: venue.name,
        address: venue.address,
        lat: venue.lat.toNumber(),
        lng: venue.lng.toNumber(),
        logoUrl: venue.logoUrl,
        category: { id: Number(venue.category.id), name: venue.category.name },
        ratingAvg: publicRating(venue.ratingAvg, venue.ratingCount),
        ratingCount: venue.ratingCount,
      },
      activeListings: venue._count.listings,
      notifyNewListings,
      createdAt: createdAt.toISOString(),
    })),
  );
});

favoritesRouter.put(
  '/:venueId',
  celebrate({
    [Segments.PARAMS]: venueParams,
    [Segments.BODY]: Joi.object({ notifyNewListings: Joi.boolean() }),
  }),
  async (req, res) => {
    const venueId = BigInt(req.params.venueId as string);
    const userId = req.user!.id;
    const exists = await prisma.venue.count({
      where: { id: venueId, status: 'active', deletedAt: null },
    });
    if (!exists) throw notFound('Заклад не знайдено');
    const notify = req.body?.notifyNewListings as boolean | undefined;
    const existed = await prisma.favorite.count({ where: { userId, venueId } });
    await prisma.favorite.upsert({
      where: { userId_venueId: { userId, venueId } },
      create: { userId, venueId, ...(notify !== undefined && { notifyNewListings: notify }) },
      update: notify !== undefined ? { notifyNewListings: notify } : {},
    });
    if (!existed) {
      const offers = await prisma.offer.findMany({
        where: { venueId, status: 'active' },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
        take: FAVORITE_SIGNAL_OFFERS,
      });
      if (offers.length) {
        await prisma.interaction.createMany({
          data: offers.map((o) => ({
            userId,
            offerId: o.id,
            venueId,
            type: 'favorite' as const,
            source: 'favorite' as const,
          })),
        });
      }
    }
    res.status(204).end();
  },
);

favoritesRouter.delete(
  '/:venueId',
  celebrate({ [Segments.PARAMS]: venueParams }),
  async (req, res) => {
    await prisma.favorite.deleteMany({
      where: { userId: req.user!.id, venueId: BigInt(req.params.venueId as string) },
    });
    res.status(204).end();
  },
);
