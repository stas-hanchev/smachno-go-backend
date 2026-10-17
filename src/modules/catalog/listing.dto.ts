import type { Prisma } from '../../generated/prisma/client.js';
import { discountPercent, formatMoney } from '../../lib/money.js';

export interface ListingCardDto {
  id: number;
  offer: {
    id: number;
    title: string;
    photoUrl: string | null;
    category: { id: number; name: string };
    tags: string[];
  };
  venue: {
    id: number;
    slug: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    ratingAvg: string | null;
    ratingCount: number;
  };
  price: string;
  originalPrice: string;
  discountPercent: number;
  quantityLeft: number;
  quantityTotal: number;
  status: string;
  pickupStart: string;
  pickupEnd: string;
  distanceM: number | null;
  isFavoriteVenue: boolean;
}

export interface ListingRow {
  id: bigint;
  price: Prisma.Decimal | string;
  original_price: Prisma.Decimal | string;
  quantity_left: number;
  quantity_total: number;
  status: string;
  pickup_start: Date;
  pickup_end: Date;
  offer_id: bigint;
  title: string;
  photo_url: string | null;
  category_id: bigint;
  category_name: string;
  venue_id: bigint;
  venue_slug: string;
  venue_name: string;
  address: string;
  lat: Prisma.Decimal | string;
  lng: Prisma.Decimal | string;
  rating_avg: Prisma.Decimal | string | null;
  rating_count: number;
  distance_m: number | null;
  is_favorite: number | bigint | null;
}

export function publicRating(avg: Prisma.Decimal | string | null, count: number): string | null {
  if (avg === null || count < 5) return null;
  return Number(avg).toFixed(2);
}

export function rowToListingCard(row: ListingRow, tags: string[]): ListingCardDto {
  return {
    id: Number(row.id),
    offer: {
      id: Number(row.offer_id),
      title: row.title,
      photoUrl: row.photo_url,
      category: { id: Number(row.category_id), name: row.category_name },
      tags,
    },
    venue: {
      id: Number(row.venue_id),
      slug: row.venue_slug,
      name: row.venue_name,
      address: row.address,
      lat: Number(row.lat),
      lng: Number(row.lng),
      ratingAvg: publicRating(row.rating_avg, Number(row.rating_count)),
      ratingCount: Number(row.rating_count),
    },
    price: formatMoney(row.price),
    originalPrice: formatMoney(row.original_price),
    discountPercent: discountPercent(row.price, row.original_price),
    quantityLeft: Number(row.quantity_left),
    quantityTotal: Number(row.quantity_total),
    status: row.status,
    pickupStart: row.pickup_start.toISOString(),
    pickupEnd: row.pickup_end.toISOString(),
    distanceM: row.distance_m === null ? null : Math.round(Number(row.distance_m)),
    isFavoriteVenue: Boolean(row.is_favorite),
  };
}
