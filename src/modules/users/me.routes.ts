import { celebrate, Joi, Segments } from 'celebrate';
import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { celebrateOptions, idNumber, lat, lng, password } from '../../lib/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import { changePassword } from '../auth/auth.service.js';
import { toUserDto } from './user.dto.js';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user!.id },
    include: {
      venueMemberships: {
        where: { status: 'active', venue: { deletedAt: null } },
        include: { venue: { select: { id: true, name: true, slug: true, status: true } } },
      },
    },
  });
  res.json({
    ...toUserDto(user),
    venues: user.venueMemberships.map((m) => ({
      id: Number(m.venue.id),
      name: m.venue.name,
      slug: m.venue.slug,
      status: m.venue.status,
      role: m.role,
    })),
  });
});

meRouter.patch(
  '/',
  celebrate(
    {
      [Segments.BODY]: Joi.object({
        firstName: Joi.string().trim().min(1).max(100),
        lastName: Joi.string().trim().max(100).allow('', null),
        phone: Joi.string()
          .pattern(/^\+[1-9]\d{7,14}$/)
          .allow(null)
          .messages({ 'string.pattern.base': 'Телефон має бути у форматі +380XXXXXXXXX' }),
        homeLat: lat.allow(null),
        homeLng: lng.allow(null),
        homeAddress: Joi.string().trim().max(255).allow('', null),
        searchRadiusKm: Joi.number().integer().min(1).max(30),
        cityId: idNumber.allow(null),
      })
        .and('homeLat', 'homeLng')
        .min(1),
    },
    celebrateOptions,
  ),
  async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(body.firstName !== undefined && { firstName: body.firstName as string }),
        ...(body.lastName !== undefined && { lastName: (body.lastName as string) || null }),
        ...(body.phone !== undefined && { phone: body.phone as string | null }),
        ...(body.homeLat !== undefined && {
          homeLat: body.homeLat as number | null,
          homeLng: body.homeLng as number | null,
        }),
        ...(body.homeAddress !== undefined && {
          homeAddress: (body.homeAddress as string) || null,
        }),
        ...(body.searchRadiusKm !== undefined && { searchRadiusKm: body.searchRadiusKm as number }),
        ...(body.cityId !== undefined && {
          cityId: body.cityId === null ? null : BigInt(body.cityId as number),
        }),
      },
    });
    res.json(toUserDto(user));
  },
);

meRouter.patch(
  '/password',
  celebrate({
    [Segments.BODY]: Joi.object({
      currentPassword: Joi.string().max(128).required(),
      newPassword: password.required(),
    }),
  }),
  async (req, res) => {
    await changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
    res.status(204).end();
  },
);
