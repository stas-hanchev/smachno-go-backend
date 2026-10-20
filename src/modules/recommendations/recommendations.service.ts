import type { InteractionSource, Prisma } from '../../generated/prisma/client.js';
import type { LatLng } from '../../lib/geo.js';
import { prisma } from '../../lib/prisma.js';
import { getSettings } from '../../lib/settings.js';
import { searchListings } from '../catalog/catalog.service.js';
import type { ListingCardDto } from '../catalog/listing.dto.js';
import {
  computePreferences,
  diversify,
  parseWeights,
  scoreListing,
  type Preferences,
} from './scoring.js';

const CANDIDATE_LIMIT = 200;
const POPULARITY_DAYS = 14;
const PERSONALIZATION_MIN_EVENTS = 3;
const PREFERENCE_WINDOW_DAYS = 90;
const PREFERENCES_MAX_AGE_MS = 3_600_000;
const SIGNAL_TYPES = ['view', 'favorite', 'reserve', 'purchase', 'pickup', 'review'] as const;
export const WEIGHTS_SETTING = 'recommendation_weights';

export interface RecommendationResult {
  data: ListingCardDto[];
  personalized: boolean;
}

export async function loadWeights() {
  const row = await prisma.setting.findUnique({ where: { key: WEIGHTS_SETTING } });
  return parseWeights(row?.value);
}

async function tagIdsByOffer(offerIds: bigint[]) {
  const map = new Map<string, number[]>();
  if (!offerIds.length) return map;
  const rows = await prisma.offerTag.findMany({
    where: { offerId: { in: offerIds } },
    select: { offerId: true, tagId: true },
  });
  for (const row of rows) {
    const key = String(row.offerId);
    map.set(key, [...(map.get(key) ?? []), Number(row.tagId)]);
  }
  return map;
}

async function popularityByOffer(offerIds: bigint[], now: Date) {
  const map = new Map<string, number>();
  if (!offerIds.length) return map;
  const rows = await prisma.interaction.groupBy({
    by: ['offerId'],
    where: {
      offerId: { in: offerIds },
      type: 'purchase',
      createdAt: { gte: new Date(now.getTime() - POPULARITY_DAYS * 86_400_000) },
    },
    _count: { _all: true },
  });
  const max = Math.max(0, ...rows.map((r) => r._count._all));
  for (const row of rows) map.set(String(row.offerId), max ? row._count._all / max : 0);
  return map;
}

function toPreferences(row: { categoryWeights: Prisma.JsonValue; tagWeights: Prisma.JsonValue }) {
  const asRecord = (value: Prisma.JsonValue) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, number>)
      : {};
  return { categoryWeights: asRecord(row.categoryWeights), tagWeights: asRecord(row.tagWeights) };
}

export async function recomputeUserPreferences(userId: bigint, now = new Date()) {
  const events = await prisma.interaction.findMany({
    where: {
      userId,
      type: { in: ['view', 'favorite', 'reserve', 'purchase', 'pickup'] },
      createdAt: { gte: new Date(now.getTime() - PREFERENCE_WINDOW_DAYS * 86_400_000) },
    },
    select: {
      type: true,
      createdAt: true,
      offer: { select: { categoryId: true, tags: { select: { tagId: true } } } },
    },
  });
  const prefs = computePreferences(
    events.map((e) => ({
      type: e.type,
      createdAt: e.createdAt,
      categoryId: Number(e.offer.categoryId),
      tagIds: e.offer.tags.map((t) => Number(t.tagId)),
    })),
    now,
  );
  await prisma.userPreferences.upsert({
    where: { userId },
    create: { userId, categoryWeights: prefs.categoryWeights, tagWeights: prefs.tagWeights },
    update: { categoryWeights: prefs.categoryWeights, tagWeights: prefs.tagWeights },
  });
  return prefs;
}

async function preferencesFor(userId: bigint | undefined, now: Date): Promise<Preferences | null> {
  if (!userId) return null;
  const signals = await prisma.interaction.count({
    where: { userId, type: { in: [...SIGNAL_TYPES] } },
  });
  if (signals < PERSONALIZATION_MIN_EVENTS) return null;
  const row = await prisma.userPreferences.findUnique({ where: { userId } });
  if (row && now.getTime() - row.updatedAt.getTime() < PREFERENCES_MAX_AGE_MS) {
    return toPreferences(row);
  }
  return recomputeUserPreferences(userId, now);
}

export async function recommend(
  point: LatLng,
  radiusKm: number,
  limit: number,
  userId?: bigint,
  now = new Date(),
): Promise<RecommendationResult> {
  const [{ data: candidates }, weights, prefs, settings] = await Promise.all([
    searchListings(
      {
        ...point,
        radiusKm,
        availableOnly: true,
        sort: 'distance',
        page: 1,
        limit: CANDIDATE_LIMIT,
      },
      userId,
    ),
    loadWeights(),
    preferencesFor(userId, now),
    getSettings(),
  ]);
  if (!candidates.length) return { data: [], personalized: prefs !== null };

  const offerIds = [...new Set(candidates.map((c) => BigInt(c.offer.id)))];
  const [tags, popularity] = await Promise.all([
    tagIdsByOffer(offerIds),
    popularityByOffer(offerIds, now),
  ]);
  const closeOffsetMs = settings.sales_close_offset_min * 60_000;

  const ranked = candidates
    .map((card) => ({
      card,
      venueId: card.venue.id,
      score: scoreListing(
        {
          distanceM: card.distanceM,
          radiusM: radiusKm * 1000,
          categoryId: card.offer.category.id,
          tagIds: tags.get(String(card.offer.id)) ?? [],
          popularity: popularity.get(String(card.offer.id)) ?? 0,
          ratingAvg: card.venue.ratingAvg,
          discountPercent: card.discountPercent,
          salesCloseAt: new Date(new Date(card.pickupEnd).getTime() - closeOffsetMs),
          isFavoriteVenue: card.isFavoriteVenue,
        },
        weights,
        prefs,
        now,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.card.id - b.card.id);

  return {
    data: diversify(ranked, limit).map((item) => item.card),
    personalized: prefs !== null,
  };
}

export interface InteractionEventInput {
  offerId: number;
  type: 'impression' | 'view';
  source?: InteractionSource;
  position?: number;
}

export async function recordInteractions(
  actor: { userId?: bigint; anonId?: string },
  events: InteractionEventInput[],
) {
  const offerIds = [...new Set(events.map((e) => BigInt(e.offerId)))];
  const offers = await prisma.offer.findMany({
    where: { id: { in: offerIds } },
    select: { id: true, venueId: true },
  });
  const venueByOffer = new Map(offers.map((o) => [String(o.id), o.venueId]));
  const rows = events.flatMap((event) => {
    const venueId = venueByOffer.get(String(event.offerId));
    if (!venueId) return [];
    return [
      {
        userId: actor.userId ?? null,
        anonId: actor.userId ? null : (actor.anonId ?? null),
        offerId: BigInt(event.offerId),
        venueId,
        type: event.type,
        source: event.source ?? null,
        position: event.position ?? null,
      },
    ];
  });
  if (rows.length) await prisma.interaction.createMany({ data: rows });
  return { accepted: rows.length };
}

export async function recomputeRecommendations(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 2 * 3_600_000);
  const users = await prisma.interaction.findMany({
    where: { userId: { not: null }, createdAt: { gte: since }, type: { in: [...SIGNAL_TYPES] } },
    distinct: ['userId'],
    select: { userId: true },
  });
  for (const { userId } of users) {
    if (userId) await recomputeUserPreferences(userId, now);
  }
  return users.length;
}
