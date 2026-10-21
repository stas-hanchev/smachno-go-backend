import { env } from '../../config/env.js';
import type { ApplicationStatus, Prisma, VenueStatus } from '../../generated/prisma/client.js';
import { publishAfterCommit } from '../../lib/after-commit.js';
import { audit } from '../../lib/audit.js';
import { AppError, businessRule, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';
import { slugify } from '../../lib/slug.js';
import { notifyAfterCommit } from '../notifications/notifications.service.js';
import { toApplicationDto } from '../partner/applications.service.js';
import { listMembers } from '../partner/members.service.js';
import { getVenueProfile } from '../partner/venue.service.js';

export interface AdminActor {
  id: bigint;
  role: 'admin' | 'super_admin' | 'customer';
  ip?: string | undefined;
}

export interface Page {
  page: number;
  limit: number;
}

const paging = (p: Page) => ({ skip: (p.page - 1) * p.limit, take: p.limit });
const meta = (p: Page, total: number) => ({ page: p.page, limit: p.limit, total });

export async function listApplications(filter: { status?: ApplicationStatus } & Page) {
  const where: Prisma.PartnerApplicationWhereInput = filter.status ? { status: filter.status } : {};
  const [items, total] = await Promise.all([
    prisma.partnerApplication.findMany({ where, orderBy: { id: 'desc' }, ...paging(filter) }),
    prisma.partnerApplication.count({ where }),
  ]);
  return { data: items.map((a) => toApplicationDto(a)), meta: meta(filter, total) };
}

export async function getApplication(id: bigint) {
  const app = await prisma.partnerApplication.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
      venues: { select: { id: true, name: true, slug: true, status: true } },
    },
  });
  if (!app) throw notFound('Заявку не знайдено');
  return {
    ...toApplicationDto(app, { reveal: true }),
    applicant: {
      id: Number(app.user.id),
      email: app.user.email,
      firstName: app.user.firstName,
      lastName: app.user.lastName,
    },
    venues: app.venues.map((v) => ({
      id: Number(v.id),
      name: v.name,
      slug: v.slug,
      status: v.status,
    })),
  };
}

async function uniqueVenueSlug(tx: Prisma.TransactionClient, name: string): Promise<string> {
  const base = slugify(name, 100);
  for (let i = 1; i < 1000; i += 1) {
    const slug = i === 1 ? base : `${base}-${i}`;
    if (!(await tx.venue.count({ where: { slug } }))) return slug;
  }
  throw new AppError('INTERNAL');
}

export async function approveApplication(
  id: bigint,
  input: {
    categoryId: number;
    cityId: number;
    lat?: number;
    lng?: number;
    commissionRate?: number;
    name?: string;
  },
  actor: AdminActor,
) {
  const settings = await getSettings();
  const venueId = await publishAfterCommit((after) =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM partner_applications WHERE id = ${id} FOR UPDATE`;
      const app = await tx.partnerApplication.findUnique({ where: { id } });
      if (!app) throw notFound('Заявку не знайдено');
      if (app.status !== 'submitted') {
        throw new AppError('ORDER_STATE_CONFLICT', 'Заявку вже розглянуто');
      }
      const [category, city] = await Promise.all([
        tx.category.findFirst({ where: { id: input.categoryId, isActive: true } }),
        tx.city.findFirst({ where: { id: input.cityId, isActive: true } }),
      ]);
      if (!category) {
        throw businessRule('Категорію не знайдено', [
          { field: 'categoryId', message: 'Невідома категорія' },
        ]);
      }
      if (!city) {
        throw businessRule('Місто не знайдено', [{ field: 'cityId', message: 'Невідоме місто' }]);
      }

      const name = input.name ?? app.businessName;
      const venue = await tx.venue.create({
        data: {
          slug: await uniqueVenueSlug(tx, name),
          name,
          categoryId: category.id,
          cityId: city.id,
          address: app.address,
          lat: input.lat ?? city.centerLat,
          lng: input.lng ?? city.centerLng,
          phone: app.contactPhone,
          legalName: app.legalName,
          taxId: app.taxId,
          iban: app.iban,
          commissionRate: input.commissionRate ?? settings.default_commission_rate,
          status: 'draft',
          applicationId: app.id,
          members: { create: { userId: app.userId, role: 'owner', status: 'active' } },
        },
      });
      await tx.partnerApplication.update({
        where: { id },
        data: { status: 'approved', reviewedBy: actor.id, reviewedAt: new Date() },
      });
      await audit(
        {
          actorId: actor.id,
          action: 'application.approve',
          entityType: 'partner_application',
          entityId: id,
          diff: { venueId: venue.id.toString(), slug: venue.slug },
          ip: actor.ip,
        },
        tx,
      );

      const link = `${env.APP_URL}/partner/onboarding`;
      notifyAfterCommit(after, {
        userId: app.userId,
        type: 'application_approved',
        category: 'account',
        title: 'Заявку схвалено',
        body: `Заклад «${venue.name}» створено. Заповніть профіль і графік, щоб опублікувати його.`,
        data: { venueId: Number(venue.id) },
        email: {
          subject: 'Вашу заявку в СмачноGo схвалено',
          text: `Вітаємо!\n\nЗаявку «${app.businessName}» схвалено. Ми створили для вас кабінет закладу «${venue.name}».\n\nЗаповніть профіль, графік роботи та створіть перший набір, а потім опублікуйте заклад:\n${link}`,
        },
      });
      return venue.id;
    }),
  );
  return getVenueProfile(venueId);
}

export async function rejectApplication(id: bigint, reason: string, actor: AdminActor) {
  await publishAfterCommit((after) =>
    prisma.$transaction(async (tx) => {
      const updated = await tx.partnerApplication.updateMany({
        where: { id, status: 'submitted' },
        data: {
          status: 'rejected',
          rejectReason: reason,
          reviewedBy: actor.id,
          reviewedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        if (!(await tx.partnerApplication.count({ where: { id } }))) {
          throw notFound('Заявку не знайдено');
        }
        throw new AppError('ORDER_STATE_CONFLICT', 'Заявку вже розглянуто');
      }
      const app = await tx.partnerApplication.findUniqueOrThrow({ where: { id } });
      await audit(
        {
          actorId: actor.id,
          action: 'application.reject',
          entityType: 'partner_application',
          entityId: id,
          diff: { reason },
          ip: actor.ip,
        },
        tx,
      );
      notifyAfterCommit(after, {
        userId: app.userId,
        type: 'application_rejected',
        category: 'account',
        title: 'Заявку відхилено',
        body: `Заявку «${app.businessName}» відхилено: ${reason}`,
        email: {
          subject: 'Рішення щодо вашої заявки в СмачноGo',
          text: `Вітаємо!\n\nНа жаль, заявку «${app.businessName}» відхилено.\nПричина: ${reason}\n\nВи можете виправити дані та подати нову заявку.`,
        },
      });
    }),
  );
  return getApplication(id);
}

export async function listVenues(
  filter: { q?: string; status?: VenueStatus; cityId?: number } & Page,
) {
  const where: Prisma.VenueWhereInput = {
    deletedAt: null,
    ...(filter.status && { status: filter.status }),
    ...(filter.cityId && { cityId: filter.cityId }),
    ...(filter.q && {
      OR: [{ name: { contains: filter.q } }, { slug: { contains: filter.q } }],
    }),
  };
  const [items, total] = await Promise.all([
    prisma.venue.findMany({
      where,
      include: { city: { select: { name: true } } },
      orderBy: { id: 'desc' },
      ...paging(filter),
    }),
    prisma.venue.count({ where }),
  ]);
  return {
    data: items.map((v) => ({
      id: Number(v.id),
      slug: v.slug,
      name: v.name,
      city: v.city.name,
      address: v.address,
      status: v.status,
      commissionRate: v.commissionRate.toNumber(),
      ratingAvg: v.ratingAvg?.toFixed(2) ?? null,
      ratingCount: v.ratingCount,
      createdAt: v.createdAt.toISOString(),
    })),
    meta: meta(filter, total),
  };
}

export async function getVenue(id: bigint) {
  const [profile, team] = await Promise.all([getVenueProfile(id), listMembers(id)]);
  return { ...profile, members: team.members };
}

export async function updateVenue(
  id: bigint,
  input: { status?: 'active' | 'paused' | 'blocked'; commissionRate?: number },
  actor: AdminActor,
) {
  const venue = await prisma.venue.findFirst({ where: { id, deletedAt: null } });
  if (!venue) throw notFound('Заклад не знайдено');
  await prisma.$transaction(async (tx) => {
    await tx.venue.update({
      where: { id },
      data: {
        ...(input.status !== undefined && { status: input.status }),
        ...(input.commissionRate !== undefined && { commissionRate: input.commissionRate }),
      },
    });
    await audit(
      {
        actorId: actor.id,
        action: 'venue.update',
        entityType: 'venue',
        entityId: id,
        diff: {
          before: { status: venue.status, commissionRate: venue.commissionRate.toNumber() },
          after: input,
        },
        ip: actor.ip,
      },
      tx,
    );
  });
  return getVenue(id);
}
