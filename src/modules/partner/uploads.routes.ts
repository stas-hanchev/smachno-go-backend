import { celebrate, Joi, Segments } from 'celebrate';
import { Router } from 'express';
import multer from 'multer';
import { MAX_IMAGE_BYTES } from '../../lib/images.js';
import { id } from '../../lib/validation.js';
import { requireVenueRole } from '../../middleware/auth.js';
import * as uploads from './uploads.service.js';

const owner = requireVenueRole(['owner']);
const image = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
}).single('file');

const venueParams = Joi.object({ venueId: id.required() });
const photoParams = Joi.object({ venueId: id.required(), photoId: id.required() });
const offerParams = Joi.object({ venueId: id.required(), offerId: id.required() });

const param = (params: Record<string, unknown>, key: string) => BigInt(params[key] as string);

export const uploadsRouter = Router();

for (const kind of ['logo', 'cover'] as const) {
  uploadsRouter.post(
    `/venues/:venueId/${kind}`,
    celebrate({ [Segments.PARAMS]: venueParams }),
    owner,
    image,
    async (req, res) => {
      res.json(await uploads.setVenueImage(param(req.params, 'venueId'), kind, req.file));
    },
  );

  uploadsRouter.delete(
    `/venues/:venueId/${kind}`,
    celebrate({ [Segments.PARAMS]: venueParams }),
    owner,
    async (req, res) => {
      await uploads.removeVenueImage(param(req.params, 'venueId'), kind);
      res.status(204).end();
    },
  );
}

uploadsRouter.post(
  '/venues/:venueId/photos',
  celebrate({ [Segments.PARAMS]: venueParams }),
  owner,
  image,
  async (req, res) => {
    res.status(201).json(await uploads.addVenuePhoto(param(req.params, 'venueId'), req.file));
  },
);

uploadsRouter.delete(
  '/venues/:venueId/photos/:photoId',
  celebrate({ [Segments.PARAMS]: photoParams }),
  owner,
  async (req, res) => {
    res.json(
      await uploads.deleteVenuePhoto(param(req.params, 'venueId'), param(req.params, 'photoId')),
    );
  },
);

uploadsRouter.post(
  '/venues/:venueId/offers/:offerId/photo',
  celebrate({ [Segments.PARAMS]: offerParams }),
  owner,
  image,
  async (req, res) => {
    res.json(
      await uploads.setOfferPhoto(
        param(req.params, 'venueId'),
        param(req.params, 'offerId'),
        req.file,
      ),
    );
  },
);

uploadsRouter.delete(
  '/venues/:venueId/offers/:offerId/photo',
  celebrate({ [Segments.PARAMS]: offerParams }),
  owner,
  async (req, res) => {
    await uploads.removeOfferPhoto(param(req.params, 'venueId'), param(req.params, 'offerId'));
    res.status(204).end();
  },
);
