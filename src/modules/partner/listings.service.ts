import type { OfferListing } from '../../generated/prisma/client.js';
import { AppError, businessRule, notFound } from '../../lib/errors.js';
import { discountPercent, formatMoney } from '../../lib/money.js';
import { prisma } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';
import { publishListingUpdate } from '../orders/order-events.js';
import {
  addDays,
  dateOnlyToDb,
  dbToDateOnly,
  dbToTime,
  isoWeekday,
  kyivDate,
  kyivTime,
  kyivToUtc,
} from '../../lib/time.js';

const MIN_WINDOW_MIN = 15;
const MAX_WINDOW_MIN = 6 * 60;

export function toPartnerListingDto(listing: OfferListing & { offer: { title: string } }) {
  return {
    id: Number(listing.id),
    offerId: Number(listing.offerId),
    offerTitle: listing.offer.title,
    pickupDate: dbToDateOnly(listing.pickupDate),
    pickupStart: listing.pickupStart.toISOString(),
    pickupEnd: listing.pickupEnd.toISOString(),
    price: formatMoney(listing.price),
    originalPrice: formatMoney(listing.originalPrice),
    discountPercent: discountPercent(listing.price, listing.originalPrice),
    quantityTotal: listing.quantityTotal,
    quantityLeft: listing.quantityLeft,
    quantitySold: listing.quantityTotal - listing.quantityLeft,
    status: listing.status,
    source: listing.source,
    cancelReason: listing.cancelReason,
  };
}

async function assertValidWindow(venueId: bigint, date: string, start: string, end: string) {
  const pickupStart = kyivToUtc(date, start);
  const pickupEnd = kyivToUtc(date, end);
  const minutes = (pickupEnd.getTime() - pickupStart.getTime()) / 60_000;
  if (minutes < MIN_WINDOW_MIN || minutes > MAX_WINDOW_MIN) {
    throw businessRule('Вікно самовивозу має тривати від 15 хвилин до 6 годин', [
      { field: 'pickupEnd', message: 'Тривалість вікна від 15 хв до 6 год' },
    ]);
  }

  const settings = await getSettings();
  if (pickupEnd.getTime() - settings.sales_close_offset_min * 60_000 <= Date.now()) {
    throw businessRule('Вікно самовивозу вже минуло або продаж закривається надто скоро');
  }

  const [hours, closure] = await Promise.all([
    prisma.venueHours.findUnique({
      where: { venueId_weekday: { venueId, weekday: isoWeekday(date) } },
    }),
    prisma.venueClosure.findUnique({
      where: { venueId_date: { venueId, date: dateOnlyToDb(date) } },
    }),
  ]);
  if (closure) throw businessRule('У цей день заклад зачинено');
  if (!hours || hours.isClosed) throw businessRule('У цей день заклад не працює за графіком');
  const opensAt = dbToTime(hours.opensAt);
  const closesAt = dbToTime(hours.closesAt);
  const closesEffective = closesAt === '00:00' ? '24:00' : closesAt;
  if (start < opensAt || end > closesEffective) {
    throw businessRule(
      `Вікно самовивозу має бути в межах графіка роботи (${opensAt}–${closesAt})`,
      [{ field: 'pickupStart', message: 'Поза графіком роботи закладу' }],
    );
  }
  return { pickupStart, pickupEnd };
}

export async function listListings(venueId: bigint, date?: string) {
  const today = kyivDate();
  const dates = date ? [date] : [today, addDays(today, 1)];
  const listings = await prisma.offerListing.findMany({
    where: { venueId, pickupDate: { in: dates.map(dateOnlyToDb) } },
    include: { offer: { select: { title: true } } },
    orderBy: [{ pickupStart: 'asc' }, { id: 'asc' }],
  });
  return listings.map(toPartnerListingDto);
}

export async function createListing(
  venueId: bigint,
  input: {
    offerId: number;
    date: string;
    pickupStart: string;
    pickupEnd: string;
    quantity: number;
  },
) {
  const offer = await prisma.offer.findFirst({ where: { id: BigInt(input.offerId), venueId } });
  if (!offer) throw notFound('Набір не знайдено');
  if (offer.status !== 'active') throw businessRule('Набір призупинено або архівовано');

  const venue = await prisma.venue.findUniqueOrThrow({
    where: { id: venueId },
    select: { status: true },
  });
  if (venue.status === 'blocked') throw new AppError('FORBIDDEN', 'Заклад заблоковано');

  const { pickupStart, pickupEnd } = await assertValidWindow(
    venueId,
    input.date,
    input.pickupStart,
    input.pickupEnd,
  );

  const existing = await prisma.offerListing.findUnique({
    where: {
      offerId_pickupDate_pickupStart: {
        offerId: offer.id,
        pickupDate: dateOnlyToDb(input.date),
        pickupStart,
      },
    },
  });
  if (existing) {
    throw new AppError('ORDER_STATE_CONFLICT', 'Випуск цього набору на цей час вже існує');
  }

  const listing = await prisma.offerListing.create({
    data: {
      offerId: offer.id,
      venueId,
      pickupDate: dateOnlyToDb(input.date),
      pickupStart,
      pickupEnd,
      price: offer.price,
      originalPrice: offer.originalPrice,
      quantityTotal: input.quantity,
      quantityLeft: input.quantity,
      status: 'on_sale',
      source: 'manual',
    },
    include: { offer: { select: { title: true } } },
  });
  await publishListingUpdate(listing.id);
  return toPartnerListingDto(listing);
}

async function findListing(venueId: bigint, listingId: bigint) {
  const listing = await prisma.offerListing.findFirst({ where: { id: listingId, venueId } });
  if (!listing) throw notFound('Випуск не знайдено');
  return listing;
}

export async function updateListing(
  venueId: bigint,
  listingId: bigint,
  input: { quantityTotal?: number; pickupStart?: string; pickupEnd?: string },
) {
  const current = await findListing(venueId, listingId);
  if (!['scheduled', 'on_sale', 'sold_out'].includes(current.status)) {
    throw new AppError('ORDER_STATE_CONFLICT', 'Закритий або скасований випуск не можна змінювати');
  }

  let window: { pickupStart: Date; pickupEnd: Date } | null = null;
  if (input.pickupStart !== undefined || input.pickupEnd !== undefined) {
    const date = dbToDateOnly(current.pickupDate);
    window = await assertValidWindow(
      venueId,
      date,
      input.pickupStart ?? kyivTime(current.pickupStart),
      input.pickupEnd ?? kyivTime(current.pickupEnd),
    );
  }

  const listing = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ quantity_total: number; quantity_left: number }[]>`
      SELECT quantity_total, quantity_left FROM offer_listings WHERE id = ${listingId} FOR UPDATE`;
    if (!locked) throw notFound('Випуск не знайдено');
    const sold = locked.quantity_total - locked.quantity_left;

    if (window && sold > 0) {
      throw businessRule('Вікно самовивозу не можна змінити: вже є замовлення');
    }
    let quantityTotal = locked.quantity_total;
    let quantityLeft = locked.quantity_left;
    if (input.quantityTotal !== undefined) {
      if (input.quantityTotal < sold) {
        throw businessRule(`Кількість не може бути меншою за вже продану (${sold})`, [
          { field: 'quantityTotal', message: `Мінімум ${sold}` },
        ]);
      }
      quantityTotal = input.quantityTotal;
      quantityLeft = input.quantityTotal - sold;
    }

    let status = current.status;
    if (status === 'on_sale' && quantityLeft === 0) status = 'sold_out';
    if (status === 'sold_out' && quantityLeft > 0) status = 'on_sale';

    return tx.offerListing.update({
      where: { id: listingId },
      data: { quantityTotal, quantityLeft, status, ...(window ?? {}) },
      include: { offer: { select: { title: true } } },
    });
  });
  await publishListingUpdate(listingId);
  return toPartnerListingDto(listing);
}

export async function closeListing(venueId: bigint, listingId: bigint) {
  await findListing(venueId, listingId);
  const result = await prisma.offerListing.updateMany({
    where: { id: listingId, status: { in: ['scheduled', 'on_sale', 'sold_out'] } },
    data: { status: 'closed' },
  });
  if (result.count === 0) {
    throw new AppError('ORDER_STATE_CONFLICT', 'Випуск вже закрито або скасовано');
  }
  const listing = await prisma.offerListing.findUniqueOrThrow({
    where: { id: listingId },
    include: { offer: { select: { title: true } } },
  });
  await publishListingUpdate(listingId);
  return toPartnerListingDto(listing);
}
