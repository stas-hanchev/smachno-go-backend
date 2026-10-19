import { celebrate, Joi, Segments } from 'celebrate';
import { Router } from 'express';
import {
  celebrateOptions,
  date,
  email,
  iban,
  id,
  idNumber,
  imageUrl,
  lat,
  lng,
  phone,
  taxId,
  time,
} from '../../lib/validation.js';
import { requireVenueRole, requireVerifiedEmail } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import * as applications from './applications.service.js';
import * as members from './members.service.js';
import * as venues from './venue.service.js';

const member = requireVenueRole(['owner', 'staff'], { allowAdmin: true });
const ownerNoAdmin = requireVenueRole(['owner']);
const ownerOrAdmin = requireVenueRole(['owner'], { allowAdmin: true });

const venueParams = Joi.object({ venueId: id.required() });
const closureParams = Joi.object({ venueId: id.required(), closureId: id.required() });
const memberParams = Joi.object({ venueId: id.required(), userId: id.required() });
const inviteParams = Joi.object({ venueId: id.required(), inviteId: id.required() });

const venueId = (params: Record<string, unknown>) => BigInt(params.venueId as string);

export const onboardingRouter = Router();

onboardingRouter.post(
  '/applications',
  rateLimit({ points: 5, durationSec: 3600, key: (req) => `applications|${req.user?.id}` }),
  requireVerifiedEmail,
  celebrate(
    {
      [Segments.BODY]: Joi.object({
        businessName: Joi.string().trim().min(2).max(255).required(),
        venueType: Joi.string().trim().min(2).max(50).required(),
        contactName: Joi.string().trim().min(2).max(255).required(),
        contactPhone: phone.required(),
        contactEmail: email.required(),
        address: Joi.string().trim().min(5).max(255).required(),
        legalName: Joi.string().trim().min(2).max(255).required(),
        taxId: taxId.required(),
        iban: iban.required(),
        venuesCount: Joi.number().integer().min(1).max(500),
      }),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    res.status(201).json(await applications.submitApplication(req.user!.id, req.body));
  },
);

onboardingRouter.get('/applications/mine', async (req, res) => {
  res.json(await applications.listMyApplications(req.user!.id));
});

onboardingRouter.post(
  '/invites/accept',
  celebrate({ [Segments.BODY]: Joi.object({ token: Joi.string().max(200).required() }) }),
  async (req, res) => {
    res.json(await members.acceptInvite(req.body.token, req.user!));
  },
);

onboardingRouter.get(
  '/venues/:venueId',
  celebrate({ [Segments.PARAMS]: venueParams }),
  member,
  async (req, res) => {
    res.json(await venues.getVenueProfile(venueId(req.params)));
  },
);

onboardingRouter.patch(
  '/venues/:venueId',
  celebrate(
    {
      [Segments.PARAMS]: venueParams,
      [Segments.BODY]: Joi.object({
        name: Joi.string().trim().min(2).max(255),
        description: Joi.string().trim().max(2000).allow('', null),
        categoryId: idNumber,
        cityId: idNumber,
        address: Joi.string().trim().min(5).max(255),
        lat,
        lng,
        phone: phone.allow(null),
        logoUrl: imageUrl.allow(null),
        coverUrl: imageUrl.allow(null),
        legalName: Joi.string().trim().min(2).max(255),
        taxId,
        iban,
      })
        .and('lat', 'lng')
        .min(1),
    },
    celebrateOptions,
  ),
  ownerNoAdmin,
  async (req, res) => {
    res.json(await venues.updateVenueProfile(venueId(req.params), req.body));
  },
);

onboardingRouter.put(
  '/venues/:venueId/hours',
  celebrate(
    {
      [Segments.PARAMS]: venueParams,
      [Segments.BODY]: Joi.object({
        hours: Joi.array()
          .items(
            Joi.object({
              weekday: Joi.number().integer().min(1).max(7).required(),
              opensAt: time,
              closesAt: time,
              isClosed: Joi.boolean().default(false),
            }),
          )
          .length(7)
          .required(),
      }),
    },
    celebrateOptions,
  ),
  ownerNoAdmin,
  async (req, res) => {
    res.json(await venues.setHours(venueId(req.params), req.body.hours));
  },
);

onboardingRouter.post(
  '/venues/:venueId/closures',
  celebrate(
    {
      [Segments.PARAMS]: venueParams,
      [Segments.BODY]: Joi.object({
        date: date.required(),
        reason: Joi.string().trim().max(255).allow(''),
      }),
    },
    celebrateOptions,
  ),
  ownerNoAdmin,
  async (req, res) => {
    res.status(201).json(await venues.addClosure(venueId(req.params), req.body));
  },
);

onboardingRouter.delete(
  '/venues/:venueId/closures/:closureId',
  celebrate({ [Segments.PARAMS]: closureParams }),
  ownerNoAdmin,
  async (req, res) => {
    await venues.deleteClosure(venueId(req.params), BigInt(req.params.closureId as string));
    res.status(204).end();
  },
);

onboardingRouter.post(
  '/venues/:venueId/activate',
  celebrate({ [Segments.PARAMS]: venueParams }),
  ownerNoAdmin,
  async (req, res) => {
    res.json(await venues.activateVenue(venueId(req.params)));
  },
);

onboardingRouter.get(
  '/venues/:venueId/members',
  celebrate({ [Segments.PARAMS]: venueParams }),
  ownerOrAdmin,
  async (req, res) => {
    res.json(await members.listMembers(venueId(req.params)));
  },
);

onboardingRouter.post(
  '/venues/:venueId/members/invite',
  rateLimit({ points: 20, durationSec: 3600, key: (req) => `invites|${req.user?.id}` }),
  celebrate({
    [Segments.PARAMS]: venueParams,
    [Segments.BODY]: Joi.object({ email: email.required() }),
  }),
  ownerNoAdmin,
  async (req, res) => {
    res
      .status(201)
      .json(await members.inviteMember(venueId(req.params), req.body.email, req.user!.id));
  },
);

onboardingRouter.delete(
  '/venues/:venueId/invites/:inviteId',
  celebrate({ [Segments.PARAMS]: inviteParams }),
  ownerNoAdmin,
  async (req, res) => {
    await members.revokeInvite(venueId(req.params), BigInt(req.params.inviteId as string));
    res.status(204).end();
  },
);

onboardingRouter.patch(
  '/venues/:venueId/members/:userId',
  celebrate({
    [Segments.PARAMS]: memberParams,
    [Segments.BODY]: Joi.object({ status: Joi.string().valid('active', 'disabled').required() }),
  }),
  ownerNoAdmin,
  async (req, res) => {
    res.json(
      await members.updateMember(
        venueId(req.params),
        BigInt(req.params.userId as string),
        req.body.status,
        req.user!.id,
      ),
    );
  },
);

onboardingRouter.delete(
  '/venues/:venueId/members/:userId',
  celebrate({ [Segments.PARAMS]: memberParams }),
  ownerNoAdmin,
  async (req, res) => {
    await members.removeMember(
      venueId(req.params),
      BigInt(req.params.userId as string),
      req.user!.id,
    );
    res.status(204).end();
  },
);
