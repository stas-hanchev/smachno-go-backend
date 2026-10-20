import { celebrate, Joi, Segments } from 'celebrate';
import { Router } from 'express';
import { AppError } from '../../lib/errors.js';
import { celebrateOptions, idNumber, lat, lng } from '../../lib/validation.js';
import { optionalAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import * as recommendations from './recommendations.service.js';

const MAX_RECOMMENDATIONS = 12;
const MAX_EVENTS = 50;

const pointQuery = {
  lat: lat.required(),
  lng: lng.required(),
  radiusKm: Joi.number().min(1).max(30).default(5),
};

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export const recommendationsRouter = Router();

recommendationsRouter.get(
  '/recommendations',
  optionalAuth,
  celebrate({
    [Segments.QUERY]: Joi.object({
      ...pointQuery,
      limit: Joi.number().integer().min(1).max(MAX_RECOMMENDATIONS).default(MAX_RECOMMENDATIONS),
    }),
  }),
  async (req, res) => {
    const query = req.query as unknown as {
      lat: number;
      lng: number;
      radiusKm: number;
      limit: number;
    };
    const result = await recommendations.recommend(
      { lat: query.lat, lng: query.lng },
      query.radiusKm,
      query.limit,
      req.user?.id,
    );
    res.json({ data: result.data, meta: { personalized: result.personalized } });
  },
);

recommendationsRouter.get(
  '/recommendations/daily',
  optionalAuth,
  celebrate({ [Segments.QUERY]: Joi.object(pointQuery) }),
  async (req, res) => {
    const query = req.query as unknown as { lat: number; lng: number; radiusKm: number };
    const result = await recommendations.recommend(
      { lat: query.lat, lng: query.lng },
      query.radiusKm,
      1,
      req.user?.id,
    );
    res.json({ listing: result.data[0] ?? null, personalized: result.personalized });
  },
);

recommendationsRouter.post(
  '/interactions',
  optionalAuth,
  rateLimit({
    points: 60,
    durationSec: 60,
    key: (req) => `interactions|${req.user?.id ?? req.ip}`,
  }),
  celebrate(
    {
      [Segments.BODY]: Joi.object({
        anonId: Joi.string().pattern(ulidPattern),
        events: Joi.array()
          .items(
            Joi.object({
              offerId: idNumber.required(),
              type: Joi.string().valid('impression', 'view').required(),
              source: Joi.string().valid(
                'home',
                'search',
                'map',
                'recommendation',
                'venue',
                'favorite',
                'direct',
              ),
              position: Joi.number().integer().min(0).max(1000),
            }),
          )
          .min(1)
          .max(MAX_EVENTS)
          .required(),
      }),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    const body = req.body as { anonId?: string; events: recommendations.InteractionEventInput[] };
    if (!req.user && !body.anonId) {
      throw new AppError('VALIDATION_ERROR', undefined, [
        { field: 'anonId', message: 'Для гостя потрібен anonId' },
      ]);
    }
    const result = await recommendations.recordInteractions(
      { userId: req.user?.id, anonId: body.anonId?.toUpperCase() },
      body.events,
    );
    res.status(202).json(result);
  },
);
