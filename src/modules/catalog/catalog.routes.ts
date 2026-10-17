import { celebrate, Joi, Segments } from 'celebrate';
import { Router, type Request } from 'express';
import type { LatLng } from '../../lib/geo.js';
import { prisma } from '../../lib/prisma.js';
import { celebrateOptions, id, lat, lng, pagination } from '../../lib/validation.js';
import { optionalAuth } from '../../middleware/auth.js';
import * as catalog from './catalog.service.js';

const idList = Joi.array().items(Joi.number().integer().positive()).single().max(20);

const pointQuery = {
  lat: lat,
  lng: lng,
};

function pointFrom(req: Request): LatLng | null {
  const { lat: qLat, lng: qLng } = req.query as { lat?: number; lng?: number };
  return qLat !== undefined && qLng !== undefined ? { lat: qLat, lng: qLng } : null;
}

export const catalogRouter = Router();

catalogRouter.use(optionalAuth);

catalogRouter.get('/cities', async (_req, res) => {
  const cities = await prisma.city.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  res.json(
    cities.map((c) => ({
      id: Number(c.id),
      name: c.name,
      slug: c.slug,
      centerLat: c.centerLat.toNumber(),
      centerLng: c.centerLng.toNumber(),
    })),
  );
});

catalogRouter.get(
  '/categories',
  celebrate({
    [Segments.QUERY]: Joi.object({
      ...pointQuery,
      radiusKm: Joi.number().min(1).max(30).default(5),
    }).and('lat', 'lng'),
  }),
  async (req, res) => {
    res.json(
      await catalog.getCategories(
        pointFrom(req),
        (req.query as unknown as { radiusKm: number }).radiusKm,
      ),
    );
  },
);

catalogRouter.get('/tags', async (_req, res) => {
  const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });
  res.json(tags.map((t) => ({ id: Number(t.id), name: t.name, slug: t.slug })));
});

catalogRouter.get('/allergens', async (_req, res) => {
  const allergens = await prisma.allergen.findMany({ orderBy: { name: 'asc' } });
  res.json(allergens.map((a) => ({ id: Number(a.id), name: a.name, slug: a.slug })));
});

catalogRouter.get(
  '/listings',
  celebrate(
    {
      [Segments.QUERY]: Joi.object({
        ...pointQuery,
        radiusKm: Joi.number().min(1).max(30).default(5),
        q: Joi.string().trim().max(100).allow(''),
        categoryIds: idList,
        tagIds: idList,
        priceMin: Joi.number().min(0),
        priceMax: Joi.number().min(0),
        pickup: Joi.string().valid('now', 'today', 'tonight', 'tomorrow'),
        pickupFrom: Joi.date().iso(),
        pickupTo: Joi.date().iso(),
        availableOnly: Joi.boolean().default(true),
        sort: Joi.string()
          .valid('distance', 'rating', 'discount', 'price', 'pickup')
          .default('distance'),
        ...pagination,
      })
        .and('lat', 'lng')
        .rename('categoryIds[]', 'categoryIds')
        .rename('tagIds[]', 'tagIds'),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    const query = req.query as unknown as catalog.ListingSearch;
    const result = await catalog.searchListings(
      { ...query, q: query.q || undefined },
      req.user?.id,
    );
    res.json({
      data: result.data,
      meta: { page: query.page, limit: query.limit, total: result.total },
    });
  },
);

catalogRouter.get(
  '/listings/:id',
  celebrate({
    [Segments.PARAMS]: Joi.object({ id: id.required() }),
    [Segments.QUERY]: Joi.object(pointQuery).and('lat', 'lng'),
  }),
  async (req, res) => {
    res.json(
      await catalog.getListing(BigInt(req.params.id as string), pointFrom(req), req.user?.id),
    );
  },
);

catalogRouter.get(
  '/listings/:id/nearby',
  celebrate({ [Segments.PARAMS]: Joi.object({ id: id.required() }) }),
  async (req, res) => {
    res.json(await catalog.getNearbyListings(BigInt(req.params.id as string), req.user?.id));
  },
);

const slugParam = Joi.object({
  slug: Joi.string()
    .max(120)
    .pattern(/^[a-z0-9-]+$/)
    .required(),
});

catalogRouter.get(
  '/venues/:slug',
  celebrate({
    [Segments.PARAMS]: slugParam,
    [Segments.QUERY]: Joi.object(pointQuery).and('lat', 'lng'),
  }),
  async (req, res) => {
    res.json(await catalog.getVenueBySlug(req.params.slug as string, pointFrom(req), req.user?.id));
  },
);

catalogRouter.get(
  '/venues/:slug/listings',
  celebrate({ [Segments.PARAMS]: slugParam }),
  async (req, res) => {
    res.json(await catalog.getVenueListings(req.params.slug as string, req.user?.id));
  },
);
