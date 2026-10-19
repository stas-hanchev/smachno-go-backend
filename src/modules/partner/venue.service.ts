import type { Prisma } from '../../generated/prisma/client.js';
import { decrypt, encrypt, maskTail } from '../../lib/crypto.js';
import { AppError, businessRule, notFound, type ErrorDetail } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { dateOnlyToDb, dbToDateOnly, dbToTime, kyivDate, timeToDb } from '../../lib/time.js';

const venueProfileInclude = {
  category: { select: { id: true, name: true } },
  city: { select: { id: true, name: true } },
  hours: { orderBy: { weekday: 'asc' } },
  closures: { orderBy: { date: 'asc' } },
} satisfies Prisma.VenueInclude;

type VenueProfile = Prisma.VenueGetPayload<{ include: typeof venueProfileInclude }>;

export interface VenueProfileInput {
  name?: string;
  description?: string | null;
  categoryId?: number;
  cityId?: number;
  address?: string;
  lat?: number;
  lng?: number;
  phone?: string | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  legalName?: string;
  taxId?: string;
  iban?: string;
}

export interface HoursInput {
  weekday: number;
  opensAt?: string;
  closesAt?: string;
  isClosed?: boolean;
}

function missingForActivation(venue: VenueProfile): ErrorDetail[] {
  const missing: ErrorDetail[] = [];
  if (!venue.name.trim()) missing.push({ field: 'name', message: 'Вкажіть назву' });
  if (!venue.address.trim()) missing.push({ field: 'address', message: 'Вкажіть адресу' });
  if (!venue.phone) missing.push({ field: 'phone', message: 'Вкажіть телефон закладу' });
  if (!venue.legalName.trim())
    missing.push({ field: 'legalName', message: 'Вкажіть юридичну назву' });
  if (!decrypt(venue.taxId)) missing.push({ field: 'taxId', message: 'Вкажіть ЄДРПОУ або ІПН' });
  if (!decrypt(venue.iban)) missing.push({ field: 'iban', message: 'Вкажіть IBAN для виплат' });
  if (!venue.hours.some((h) => !h.isClosed)) {
    missing.push({ field: 'hours', message: 'Заповніть графік роботи' });
  }
  return missing;
}

function toVenueProfileDto(venue: VenueProfile) {
  const today = kyivDate();
  const missing = missingForActivation(venue);
  return {
    id: Number(venue.id),
    slug: venue.slug,
    name: venue.name,
    description: venue.description,
    category: { id: Number(venue.category.id), name: venue.category.name },
    city: { id: Number(venue.city.id), name: venue.city.name },
    address: venue.address,
    lat: venue.lat.toNumber(),
    lng: venue.lng.toNumber(),
    phone: venue.phone,
    logoUrl: venue.logoUrl,
    coverUrl: venue.coverUrl,
    legalName: venue.legalName,
    taxId: maskTail(decrypt(venue.taxId)),
    iban: maskTail(decrypt(venue.iban)),
    commissionRate: venue.commissionRate.toNumber(),
    status: venue.status,
    hours: venue.hours.map((h) => ({
      weekday: h.weekday,
      opensAt: dbToTime(h.opensAt),
      closesAt: dbToTime(h.closesAt),
      isClosed: h.isClosed,
    })),
    closures: venue.closures
      .filter((c) => dbToDateOnly(c.date) >= today)
      .map((c) => ({ id: Number(c.id), date: dbToDateOnly(c.date), reason: c.reason })),
    activation: { ready: missing.length === 0, missing },
  };
}

async function loadVenue(venueId: bigint): Promise<VenueProfile> {
  const venue = await prisma.venue.findFirst({
    where: { id: venueId, deletedAt: null },
    include: venueProfileInclude,
  });
  if (!venue) throw notFound('Заклад не знайдено');
  return venue;
}

export async function getVenueProfile(venueId: bigint) {
  return toVenueProfileDto(await loadVenue(venueId));
}

export async function updateVenueProfile(venueId: bigint, input: VenueProfileInput) {
  if (input.categoryId !== undefined) {
    const exists = await prisma.category.count({ where: { id: input.categoryId, isActive: true } });
    if (!exists) {
      throw businessRule('Категорію не знайдено', [
        { field: 'categoryId', message: 'Невідома категорія' },
      ]);
    }
  }
  if (input.cityId !== undefined) {
    const exists = await prisma.city.count({ where: { id: input.cityId, isActive: true } });
    if (!exists) {
      throw businessRule('Місто не знайдено', [{ field: 'cityId', message: 'Невідоме місто' }]);
    }
  }
  await loadVenue(venueId);
  await prisma.venue.update({
    where: { id: venueId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description || null }),
      ...(input.categoryId !== undefined && { categoryId: BigInt(input.categoryId) }),
      ...(input.cityId !== undefined && { cityId: BigInt(input.cityId) }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.lat !== undefined && { lat: input.lat }),
      ...(input.lng !== undefined && { lng: input.lng }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
      ...(input.coverUrl !== undefined && { coverUrl: input.coverUrl }),
      ...(input.legalName !== undefined && { legalName: input.legalName }),
      ...(input.taxId !== undefined && { taxId: encrypt(input.taxId) }),
      ...(input.iban !== undefined && {
        iban: encrypt(input.iban.replace(/\s+/g, '').toUpperCase()),
      }),
    },
  });
  return getVenueProfile(venueId);
}

export async function setHours(venueId: bigint, hours: HoursInput[]) {
  const weekdays = new Set(hours.map((h) => h.weekday));
  if (hours.length !== 7 || weekdays.size !== 7) {
    throw businessRule('Графік має містити всі 7 днів тижня', [
      { field: 'hours', message: 'Потрібно 7 різних днів' },
    ]);
  }
  for (const h of hours) {
    if (h.isClosed) continue;
    if (!h.opensAt || !h.closesAt) {
      throw businessRule('Вкажіть час відкриття й закриття', [
        { field: `hours.${h.weekday}`, message: 'Потрібен час роботи' },
      ]);
    }
    if (h.closesAt !== '00:00' && h.closesAt <= h.opensAt) {
      throw businessRule('Час закриття має бути пізніше за час відкриття', [
        { field: `hours.${h.weekday}`, message: 'Некоректний інтервал' },
      ]);
    }
  }
  await loadVenue(venueId);
  await prisma.$transaction([
    prisma.venueHours.deleteMany({ where: { venueId } }),
    prisma.venueHours.createMany({
      data: hours.map((h) => ({
        venueId,
        weekday: h.weekday,
        opensAt: timeToDb(h.isClosed ? '00:00' : h.opensAt!),
        closesAt: timeToDb(h.isClosed ? '00:00' : h.closesAt!),
        isClosed: h.isClosed ?? false,
      })),
    }),
  ]);
  return getVenueProfile(venueId);
}

export async function addClosure(venueId: bigint, input: { date: string; reason?: string }) {
  if (input.date < kyivDate()) throw businessRule('Не можна додати вихідний у минулому');
  const activeListings = await prisma.offerListing.count({
    where: {
      venueId,
      pickupDate: dateOnlyToDb(input.date),
      status: { in: ['scheduled', 'on_sale', 'sold_out'] },
    },
  });
  if (activeListings) {
    throw businessRule('На цю дату є активні випуски. Спершу закрийте або скасуйте їх');
  }
  const existing = await prisma.venueClosure.findUnique({
    where: { venueId_date: { venueId, date: dateOnlyToDb(input.date) } },
  });
  if (existing) throw new AppError('ORDER_STATE_CONFLICT', 'Цей день вже позначено вихідним');
  const closure = await prisma.venueClosure.create({
    data: { venueId, date: dateOnlyToDb(input.date), reason: input.reason || null },
  });
  return { id: Number(closure.id), date: input.date, reason: closure.reason };
}

export async function deleteClosure(venueId: bigint, closureId: bigint) {
  const result = await prisma.venueClosure.deleteMany({ where: { id: closureId, venueId } });
  if (result.count === 0) throw notFound('Вихідний не знайдено');
}

export async function activateVenue(venueId: bigint) {
  const venue = await loadVenue(venueId);
  if (venue.status === 'active') return toVenueProfileDto(venue);
  if (venue.status !== 'draft') {
    throw new AppError(
      'FORBIDDEN',
      venue.status === 'blocked'
        ? 'Заклад заблоковано адміністратором'
        : 'Заклад призупинено адміністратором',
    );
  }
  const missing = missingForActivation(venue);
  if (missing.length) {
    throw businessRule('Заповніть профіль закладу перед публікацією', missing);
  }
  const updated = await prisma.venue.updateMany({
    where: { id: venueId, status: 'draft' },
    data: { status: 'active' },
  });
  if (updated.count === 0) throw new AppError('ORDER_STATE_CONFLICT');
  return getVenueProfile(venueId);
}
