import { Prisma } from '../../generated/prisma/client.js';
import { notFound } from '../../lib/errors.js';
import { boundingBox, distanceMeters, sqlDistance, sqlInBox, type LatLng } from '../../lib/geo.js';
import { discountPercent, formatMoney } from '../../lib/money.js';
import { prisma } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';
import { addDays, dateOnlyToDb, dbToTime, kyivDate, kyivToUtc } from '../../lib/time.js';
import {
  publicRating,
  rowToListingCard,
  type ListingCardDto,
  type ListingRow,
} from './listing.dto.js';

export type PickupFilter = 'now' | 'today' | 'tonight' | 'tomorrow';
export type ListingSort = 'distance' | 'rating' | 'discount' | 'price' | 'pickup';

export interface ListingSearch {
  lat?: number;
  lng?: number;
  radiusKm: number;
  q?: string;
  categoryIds?: number[];
  tagIds?: number[];
  priceMin?: number;
  priceMax?: number;
  pickup?: PickupFilter;
  pickupFrom?: Date;
  pickupTo?: Date;
  availableOnly: boolean;
  sort: ListingSort;
  page: number;
  limit: number;
  venueIds?: bigint[];
  excludeListingId?: bigint;
}

const TONIGHT_FROM = '18:00';
const NOW_WINDOW_MIN = 60;

function pickupCondition(filter: PickupFilter): Prisma.Sql {
  const today = kyivDate();
  switch (filter) {
    case 'now':
      return Prisma.sql`l.pickup_start <= ${new Date(Date.now() + NOW_WINDOW_MIN * 60_000)}`;
    case 'today':
      return Prisma.sql`l.pickup_date = ${dateOnlyToDb(today)}`;
    case 'tonight':
      return Prisma.sql`l.pickup_date = ${dateOnlyToDb(today)} AND l.pickup_start >= ${kyivToUtc(today, TONIGHT_FROM)}`;
    case 'tomorrow':
      return Prisma.sql`l.pickup_date = ${dateOnlyToDb(addDays(today, 1))}`;
  }
}

function orderBy(sort: ListingSort, hasPoint: boolean): Prisma.Sql {
  switch (sort) {
    case 'distance':
      return hasPoint
        ? Prisma.sql`distance_m ASC, l.pickup_start ASC`
        : Prisma.sql`l.pickup_start ASC`;
    case 'rating':
      return Prisma.sql`(v.rating_count >= 5) DESC, v.rating_avg DESC, l.id DESC`;
    case 'discount':
      return Prisma.sql`(l.original_price - l.price) / l.original_price DESC, l.id DESC`;
    case 'price':
      return Prisma.sql`l.price ASC, l.id DESC`;
    case 'pickup':
      return Prisma.sql`l.pickup_start ASC, l.id DESC`;
  }
}

async function tagsByOffer(offerIds: bigint[]): Promise<Map<bigint, string[]>> {
  const map = new Map<bigint, string[]>();
  if (!offerIds.length) return map;
  const rows = await prisma.offerTag.findMany({
    where: { offerId: { in: offerIds } },
    include: { tag: { select: { name: true } } },
  });
  for (const row of rows) {
    const list = map.get(row.offerId) ?? [];
    list.push(row.tag.name);
    map.set(row.offerId, list);
  }
  return map;
}

export async function searchListings(
  params: ListingSearch,
  userId?: bigint,
): Promise<{ data: ListingCardDto[]; total: number }> {
  const point: LatLng | null =
    params.lat !== undefined && params.lng !== undefined
      ? { lat: params.lat, lng: params.lng }
      : null;
  const settings = await getSettings();
  const salesCloseAt = new Date(Date.now() + settings.sales_close_offset_min * 60_000);

  const where: Prisma.Sql[] = [
    Prisma.sql`v.status = 'active' AND v.deleted_at IS NULL`,
    Prisma.sql`o.status = 'active'`,
    params.availableOnly
      ? Prisma.sql`l.status = 'on_sale' AND l.quantity_left > 0 AND l.pickup_end > ${salesCloseAt}`
      : Prisma.sql`l.status IN ('on_sale', 'sold_out') AND l.pickup_end > ${new Date()}`,
  ];

  if (point) {
    const radiusM = params.radiusKm * 1000;
    where.push(sqlInBox('v', boundingBox(point, radiusM)));
    where.push(Prisma.sql`${sqlDistance('v', point)} <= ${radiusM}`);
  }
  if (params.q) {
    const like = `%${params.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      Prisma.sql`(o.title LIKE ${like} OR v.name LIKE ${like} OR o.description LIKE ${like})`,
    );
  }
  if (params.categoryIds?.length) {
    where.push(Prisma.sql`o.category_id IN (${Prisma.join(params.categoryIds)})`);
  }
  for (const tagId of params.tagIds ?? []) {
    where.push(
      Prisma.sql`EXISTS (SELECT 1 FROM offer_tags ot WHERE ot.offer_id = o.id AND ot.tag_id = ${tagId})`,
    );
  }
  if (params.priceMin !== undefined) where.push(Prisma.sql`l.price >= ${params.priceMin}`);
  if (params.priceMax !== undefined) where.push(Prisma.sql`l.price <= ${params.priceMax}`);
  if (params.pickup) where.push(pickupCondition(params.pickup));
  if (params.pickupFrom) where.push(Prisma.sql`l.pickup_start >= ${params.pickupFrom}`);
  if (params.pickupTo) where.push(Prisma.sql`l.pickup_end <= ${params.pickupTo}`);
  if (params.venueIds?.length) where.push(Prisma.sql`v.id IN (${Prisma.join(params.venueIds)})`);
  if (params.excludeListingId) where.push(Prisma.sql`l.id <> ${params.excludeListingId}`);

  const whereSql = Prisma.join(where, ' AND ');
  const from = Prisma.sql`
    FROM offer_listings l
    JOIN offers o ON o.id = l.offer_id
    JOIN venues v ON v.id = l.venue_id
    JOIN categories c ON c.id = o.category_id`;

  const distanceSelect = point ? sqlDistance('v', point) : Prisma.sql`NULL`;
  const favoriteSelect = userId
    ? Prisma.sql`EXISTS (SELECT 1 FROM favorites f WHERE f.venue_id = v.id AND f.user_id = ${userId})`
    : Prisma.sql`0`;

  const offset = (params.page - 1) * params.limit;
  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<ListingRow[]>`
      SELECT l.id, l.price, l.original_price, l.quantity_left, l.quantity_total, l.status,
             l.pickup_start, l.pickup_end,
             o.id AS offer_id, o.title, o.photo_url, o.category_id, c.name AS category_name,
             v.id AS venue_id, v.slug AS venue_slug, v.name AS venue_name, v.address, v.lat, v.lng,
             v.rating_avg, v.rating_count,
             ${distanceSelect} AS distance_m,
             ${favoriteSelect} AS is_favorite
      ${from}
      WHERE ${whereSql}
      ORDER BY ${orderBy(params.sort, point !== null)}
      LIMIT ${params.limit} OFFSET ${offset}`,
    prisma.$queryRaw<{ total: bigint }[]>`SELECT COUNT(*) AS total ${from} WHERE ${whereSql}`,
  ]);

  const tags = await tagsByOffer([...new Set(rows.map((r) => r.offer_id))]);
  return {
    data: rows.map((row) => rowToListingCard(row, tags.get(row.offer_id) ?? [])),
    total: Number(countRows[0]?.total ?? 0),
  };
}

const ECO_IMPACT_NOTE = 'Орієнтовний вплив одного набору';

export async function getListing(id: bigint, point: LatLng | null, userId?: bigint) {
  const listing = await prisma.offerListing.findFirst({
    where: { id, venue: { status: 'active', deletedAt: null } },
    include: {
      offer: {
        include: {
          category: true,
          tags: { include: { tag: true } },
          allergens: { include: { allergen: true } },
        },
      },
      venue: { include: { hours: { orderBy: { weekday: 'asc' } } } },
    },
  });
  if (!listing) throw notFound('Набір не знайдено');

  const settings = await getSettings();
  const { offer, venue } = listing;
  const weightKg = offer.estWeightKg.toNumber();
  const isFavorite = userId
    ? (await prisma.favorite.count({ where: { userId, venueId: venue.id } })) > 0
    : false;

  return {
    id: Number(listing.id),
    status: listing.status,
    pickupDate: listing.pickupDate.toISOString().slice(0, 10),
    pickupStart: listing.pickupStart.toISOString(),
    pickupEnd: listing.pickupEnd.toISOString(),
    price: formatMoney(listing.price),
    originalPrice: formatMoney(listing.originalPrice),
    savingAmount: formatMoney(listing.originalPrice.minus(listing.price)),
    discountPercent: discountPercent(listing.price, listing.originalPrice),
    quantityLeft: listing.quantityLeft,
    quantityTotal: listing.quantityTotal,
    maxPerOrder: offer.maxPerOrder,
    salesCloseAt: new Date(
      listing.pickupEnd.getTime() - settings.sales_close_offset_min * 60_000,
    ).toISOString(),
    offer: {
      id: Number(offer.id),
      title: offer.title,
      description: offer.description,
      photoUrl: offer.photoUrl,
      category: {
        id: Number(offer.category.id),
        name: offer.category.name,
        slug: offer.category.slug,
      },
      tags: offer.tags.map((t) => ({ id: Number(t.tag.id), name: t.tag.name, slug: t.tag.slug })),
      allergens: offer.allergens.map((a) => ({
        id: Number(a.allergen.id),
        name: a.allergen.name,
        slug: a.allergen.slug,
      })),
    },
    ecoImpact: {
      note: ECO_IMPACT_NOTE,
      weightKg: Number(weightKg.toFixed(2)),
      co2Kg: Number((weightKg * settings.co2_per_kg).toFixed(2)),
    },
    venue: {
      id: Number(venue.id),
      slug: venue.slug,
      name: venue.name,
      address: venue.address,
      phone: venue.phone,
      lat: venue.lat.toNumber(),
      lng: venue.lng.toNumber(),
      logoUrl: venue.logoUrl,
      ratingAvg: publicRating(venue.ratingAvg, venue.ratingCount),
      ratingCount: venue.ratingCount,
      hours: venue.hours.map((h) => ({
        weekday: h.weekday,
        opensAt: dbToTime(h.opensAt),
        closesAt: dbToTime(h.closesAt),
        isClosed: h.isClosed,
      })),
      isFavorite,
    },
    distanceM: point
      ? Math.round(
          distanceMeters(point, {
            lat: venue.lat.toNumber(),
            lng: venue.lng.toNumber(),
          }),
        )
      : null,
  };
}

export async function getNearbyListings(id: bigint, userId?: bigint) {
  const listing = await prisma.offerListing.findUnique({
    where: { id },
    include: { venue: { select: { lat: true, lng: true } } },
  });
  if (!listing) throw notFound('Набір не знайдено');
  const { data } = await searchListings(
    {
      lat: listing.venue.lat.toNumber(),
      lng: listing.venue.lng.toNumber(),
      radiusKm: 5,
      availableOnly: true,
      sort: 'distance',
      page: 1,
      limit: 6,
      excludeListingId: id,
    },
    userId,
  );
  return data;
}

export async function getVenueBySlug(slug: string, point: LatLng | null, userId?: bigint) {
  const venue = await prisma.venue.findFirst({
    where: { slug, status: 'active', deletedAt: null },
    include: {
      category: true,
      city: true,
      hours: { orderBy: { weekday: 'asc' } },
      photos: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!venue) throw notFound('Заклад не знайдено');
  const isFavorite = userId
    ? (await prisma.favorite.count({ where: { userId, venueId: venue.id } })) > 0
    : false;

  return {
    id: Number(venue.id),
    slug: venue.slug,
    name: venue.name,
    description: venue.description,
    category: {
      id: Number(venue.category.id),
      name: venue.category.name,
      slug: venue.category.slug,
    },
    city: { id: Number(venue.city.id), name: venue.city.name, slug: venue.city.slug },
    address: venue.address,
    lat: venue.lat.toNumber(),
    lng: venue.lng.toNumber(),
    phone: venue.phone,
    logoUrl: venue.logoUrl,
    coverUrl: venue.coverUrl,
    photos: venue.photos.map((p) => p.url),
    ratingAvg: publicRating(venue.ratingAvg, venue.ratingCount),
    ratingCount: venue.ratingCount,
    isNew: venue.ratingCount < 5,
    hours: venue.hours.map((h) => ({
      weekday: h.weekday,
      opensAt: dbToTime(h.opensAt),
      closesAt: dbToTime(h.closesAt),
      isClosed: h.isClosed,
    })),
    distanceM: point
      ? Math.round(distanceMeters(point, { lat: venue.lat.toNumber(), lng: venue.lng.toNumber() }))
      : null,
    isFavorite,
  };
}

export async function getVenueListings(slug: string, userId?: bigint) {
  const venue = await prisma.venue.findFirst({
    where: { slug, status: 'active', deletedAt: null },
    select: { id: true },
  });
  if (!venue) throw notFound('Заклад не знайдено');
  const { data } = await searchListings(
    {
      radiusKm: 30,
      availableOnly: false,
      sort: 'pickup',
      page: 1,
      limit: 50,
      venueIds: [venue.id],
    },
    userId,
  );
  const today = kyivDate();
  const tomorrow = addDays(today, 1);
  return data.filter((l) => {
    const date = kyivDate(new Date(l.pickupStart));
    return date === today || date === tomorrow;
  });
}

export async function getCategories(point: LatLng | null, radiusKm: number) {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  let counts = new Map<bigint, number>();
  if (point) {
    const settings = await getSettings();
    const radiusM = radiusKm * 1000;
    const rows = await prisma.$queryRaw<{ category_id: bigint; cnt: bigint }[]>`
      SELECT o.category_id, COUNT(*) AS cnt
      FROM offer_listings l
      JOIN offers o ON o.id = l.offer_id
      JOIN venues v ON v.id = l.venue_id
      WHERE v.status = 'active' AND v.deleted_at IS NULL AND o.status = 'active'
        AND l.status = 'on_sale' AND l.quantity_left > 0
        AND l.pickup_end > ${new Date(Date.now() + settings.sales_close_offset_min * 60_000)}
        AND ${sqlInBox('v', boundingBox(point, radiusM))}
        AND ${sqlDistance('v', point)} <= ${radiusM}
      GROUP BY o.category_id`;
    counts = new Map(rows.map((r) => [r.category_id, Number(r.cnt)]));
  }
  return categories.map((c) => ({
    id: Number(c.id),
    name: c.name,
    slug: c.slug,
    icon: c.icon,
    ...(point ? { activeListings: counts.get(c.id) ?? 0 } : {}),
  }));
}
